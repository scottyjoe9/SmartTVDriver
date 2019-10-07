import { Guid } from "guid-typescript";
import { IPluginModule, IPluginInstance } from "../../managers/plugins/IPlugin";
import { ParamEvent } from "../../../../common/tools/Event";
import { IParamEvent } from "../../../../common/tools/IEvent";
import { ILogger } from "../../logger/ILogger";
import { IPluginState } from "../../../../common/interfaces/IPluginState";
import { pad } from "../../../../common/tools/Helpers";
import _ = require('serialport');
import moment = require('moment');
import fs = require('fs');
import path = require('path');
import net = require('net');


let PluginUid: string = "96f068ae-bc40-421e-944f-8d0e4290c848";

interface ILGTVSettings{
    hostname: {value:string, type:string, label:string},
    port: { value:number, type:string, label:string },
    baudRate: {value:number, type:string, label: string},
    PollRate: {value: number, type:string, label:string }
}

let defaultSettings:ILGTVSettings = 
{
    hostname: { value:"lg-tv-moxa", type:"string", label: "TV Host Address"},
    port: { value: 3463, type:"integer", label: "TV Port Number"},
    baudRate: {value:9600, type:"integer", label: "Com Port Baud Rate"},
    PollRate: { value: 500, type: "integer", label: "Poll Rate ms" }
}

export class LGTVController implements IPluginModule {

    private logger!: ILogger;
    private clientLayout: string;
    constructor() {
        this.clientLayout = fs.readFileSync(path.join(__dirname, "lg_tv_controller.html")).toString();
    }

    set SetLogger(logger: ILogger) {
        this.logger = logger;
    }

    get ClientLayout(): string {
        return this.clientLayout;
    }
    public get DefaultSettings(): string {
        return JSON.stringify(defaultSettings);
    }

    public get Name(): string {
        return "LG TV Controller";
    }

    public get UID(): string {
        return PluginUid;
    }

    public get Version(): string {
        return "0.0.0.1";
    }

    public createInstance(name: string, settings: string, instanceUid: string = null): IPluginInstance {
        let log = this.logger;
        return new lg_tv_controller_instance(instanceUid, name, settings, log);
    }
}

class InstanceState { Power: boolean; Input: string; Inputs:{Value:string,DisplayName:string}[]; Volume: number; Mute: boolean; };

export class lg_tv_controller_instance implements IPluginInstance {
    private guid: string;
    private pluginStateChange: ParamEvent<IPluginState>;
    private logger!: ILogger;
    private name: string;
    private settings:ILGTVSettings = defaultSettings;
    private state: InstanceState = new InstanceState();
    private inputs: {Value:string, DisplayName:string}[] = 
        [{Value: "DTV", DisplayName: "DTV"},
        {Value: "AV1", DisplayName: "AV1"},
        {Value: "AV2", DisplayName: "AV2"},
        {Value: "Component1", DisplayName: "Component1"},
        {Value: "Component2", DisplayName: "Component2"},
        {Value: "RGB", DisplayName: "RGB"},
        {Value: "HDMI1", DisplayName: "DVD"},
        {Value: "HDMI2", DisplayName: "Computer"},
        {Value: "HDMI3", DisplayName: "Chromecast"}];

    private socket: net.Socket = null;
    private buffer: string[] = [];

    private intervalId: any;
    private lastVolumeUpdate: number = moment.now();

    private host:string;
    private port:number;

    constructor(instanceUid: string = null, name: string, settings: string, logger: ILogger) {
        logger.info("lg_tv_controller instance ctor....");
        if(instanceUid)
            this.guid = instanceUid;
        else
            this.guid = Guid.create().toString();
        
        this.name = name;
        this.pluginStateChange = new ParamEvent<IPluginState>();
        this.logger = logger;
        this.Settings = settings;
    }

    private settingsUpdated(){
        this.logger.info("lg_tv_controller.settingsUpdated():");

        this.logger.info("here: " + this.settings.hostname.value + " : " +  this.settings.port.value);

        this.host = this.settings.hostname.value;
        this.port = this.settings.port.value;

        if (this.intervalId){
            clearInterval(this.intervalId);
        }

        this.socket = net.createConnection({port: this.settings.port.value, host: this.settings.hostname.value}, () => {
            this.intervalId = setInterval(() => this.updateTvStatus(), this.settings.PollRate.value);
        });

        this.socket.on('data', (data) => {
            for (let i = 0; i < data.length; i++) {
                let char = data[i];
                if (char == "x".charCodeAt(0)) {
                    let packet: string = "";
                    for (let i = 0; i < this.buffer.length; i++) {
                        let c = this.buffer[i];
                        packet += c;
                    }
                    this.processPacket(packet);
                    this.buffer = [];
                }
                else {
                    this.buffer.push(String.fromCharCode(Number(char)));
                }
            }
        });
    }

    private processPacket(packet: string) {
        let command: string = Commands[packet[0]];
        let success: boolean = (packet[5] === 'O' && packet[6] === 'K');
        if (success) {
            let data: number = parseInt(packet.slice(7, 9), 16);
            let stateChanged: boolean = false;
            switch (command) {
                case "Power":
                    let newPower = data === 0 ? false : true;
                    if (this.state.Power !== newPower) {
                        this.state.Power = newPower;
                        stateChanged = true;
                        this.logger.debug("Power Changed: " + newPower);
                    }
                    break;
                case "Volume":
                    if (this.state.Volume !== data) {
                        if (moment.now() - this.lastVolumeUpdate > 1000) {
                            this.state.Volume = data;
                            stateChanged = true;
                            this.logger.debug("Volume Changed: " + data);
                        }
                    }
                    break;
                case "Mute":
                    let newMute = data === 0 ? true : false;
                    if (this.state.Mute !== newMute) {
                        this.state.Mute = newMute;
                        stateChanged = true;
                        this.logger.debug("Mute Changed: " + newMute);
                    }
                    break;
                case "Input":
                    let newInput = InputSelectOptions[data];
                    if (this.state.Input !== newInput) {
                        this.state.Input = newInput;
                        stateChanged = true;
                        this.logger.debug("Input Changed: " + newInput);
                    }
                    break;
                default:
                    this.logger.debug("not a status return packet....");
            }
            if (stateChanged) {
                this.logger.debug("updating state: " + JSON.stringify(this.PluginState));
                this.triggerStateChangeEvent();
            }
        }
    }

    private updateTvStatus() {
        if (this.socket){
            this.socket.write(PowerMsg(PowerOptions.Request));
            this.socket.write(VolumeMuteMsg(VolumeMuteOptions.Request));
            this.socket.write(VolumeControlMsg(0xFF));
            this.socket.write(InputSelectMsg(InputSelectOptions.Request));
        }
    }

    public set Settings(settings: string) {
        this.settings = JSON.parse(settings);
        this.logger.info("host: " + this.host + " : " + this.port);
        if (this.host !== this.settings.hostname.value ||
            this.port !== this.settings.port.value)
            this.settingsUpdated();
    }

    public get Settings(): string {
        return JSON.stringify(this.settings);
    }

    public get PluginStateChange(): IParamEvent<IPluginState> {
        return this.pluginStateChange;
    }

    public get Name(): string {
        return this.name;
    }

    public get PluginState(): IPluginState {
        return { pluginUid: PluginUid, instanceUid: this.UID, state: this.State };
    }

    private get State(): InstanceState{
        this.state.Inputs = this.Inputs;
        return this.state;
    }

    private get Inputs(): {Value:string, DisplayName:string}[]{
        return this.inputs;
    }

    public get PluginUID(): string {
        return PluginUid;
    }

    public get UID(): string {
        return this.guid;
    }

    public performAction(action: string, params: any) {
        this.logger.verbose("performAction: " + action + " : " + JSON.stringify(params));
        try{
            switch (action){
                case "power":
                this.socket.write(PowerMsg(params ? PowerOptions.On : PowerOptions.Off));
                break;
                case "volume":
                this.lastVolumeUpdate = moment.now();
                this.socket.write(VolumeControlMsg(params));
                break;
                case "mute":
                this.socket.write(VolumeMuteMsg(params ? VolumeMuteOptions.On : VolumeMuteOptions.Off));
                break;
                case "input":
                this.socket.write(InputSelectMsg(InputSelectOptions[<string>params]));
                break;
                case "keycode":
                this.socket.write(KeyCodeMsg(KeyCodeOptions[<string>params]));
                break;
            }
        }catch(err){
            this.logger.error("lg_tv_controller.performAction: failed to perform action with exception: " + err);
        }
    }

    public destroyInstance(): void {
        clearInterval(this.intervalId);
        this.socket.destroy();
    }

    private triggerStateChangeEvent() {
        this.pluginStateChange.trigger(this.PluginState);
    }
}

function BaseMsg(command1: string, command2: string, data: number): string {
    if (data !== null &&
        data !== undefined)
        return command1 + command2 + " 0 " + data.toString(16) + "\r";
    else
        throw "data is not defined!";
}

enum Commands {
    Power = 'a',
    Input = 'b',
    KeyCode = 'c',
    ScreenMute = 'd',
    Mute = 'e',
    Volume = 'f',
    Contrast = 'g',
    Brightness = 'h',
    Colour = 'i',
    Tint = 'j',
    Sharpness = 'k',
    OSDSelect = 'l',
    RemoteLock = 'm',
    Balance = 't',
    ColourTemperature = 'u',
    a = 'Power',
    b = 'Input',
    c = 'KeyCode',
    d = 'ScreenMute',
    e = 'Mute',
    f = 'Volume',
    g = 'Contrast',
    h = 'Brightness',
    i = 'Colour',
    j = 'Tint',
    k = 'Sharpness',
    l = 'OSDSelect',
    m = 'RemoteLock',
    t = 'Balance',
    u = 'ColourTemperature'
}

//data: 0 - off, 1 - on
enum PowerOptions {
    Off = 0,
    On = 1,
    Request = 0xFF
}

function PowerMsg(data: PowerOptions) {
    return BaseMsg('k', Commands.Power, data);
}

//data: 2 - AV,   4 - Component1,
//5 - Component2, 6 - RGB (DTV)
//7 - RGB (PC),   8 - HDMI (DTV)
//9 - HDMI (PC)
enum InputSelectOptions {
    DTV = 0x00,
    AV1 = 0x20,
    AV2 = 0x21,
    Component1 = 0x40,
    Component2 = 0x65,
    RGB = 0x60,
    HDMI1 = 0x90,
    HDMI2 = 0x91,
    HDMI3 = 0x92,
    Request = 0xFF
}
function InputSelectMsg(data: InputSelectOptions) {
    return BaseMsg('x', Commands.Input, data);
}
// // Data 1 : Normal Screen (4:3) 5 : Zoom2
// // 2 : Wide Screen (16 :9) 6 : Original
// // 3 : Horizon (Spectacle) 7 : 14 : 9
// // 4 : Zoom1 8 : Full (Europe version only)
// // 9 : 1 : 1 (PC)
// enum AspectRatioOptions{
//     NormalScreen = 1,
//     WideScreen = 2,
//     Horizon = 3,
//     Zoom1 = 4,
//     Zoom2 = 5,
//     Original = 6,
//     Fourteen_Nine = 7,
//     Full = 8,
//     One_One = 9,
//     Request = 0xFF
// }
// function AspectRatioMsg(data:AspectRatioOptions){
//     return BaseMsg('k','c',data);
// }

// Data 0 : Screen mute off (Picture on)
// 1 : Screen mute on (Picture off)
enum ScreenMuteOptions {
    Off = 0,
    On = 1,
    Request = 0xFF
}
function ScreenMuteMsg(data: ScreenMuteOptions) {
    return BaseMsg('k', Commands.ScreenMute, data);
}

// Data 0 : Volume Mute On (Volume Off)
// 1 : Volume Mute Off (Volume On)
enum VolumeMuteOptions {
    Off = 1,
    On = 0,
    Request = 0xFF
}
function VolumeMuteMsg(data: VolumeMuteOptions) {
    return BaseMsg('k', Commands.Mute, data);
}

// Data Min : 00H ~ Max : 64H
function VolumeControlMsg(data: number) {
    return BaseMsg('k', Commands.Volume, data);
}

// Data Min : 00H ~ Max : 64H
function ContrastMsg(data: number) {
    return BaseMsg('k', Commands.Contrast, data);
}

// Data Min : 00H ~ Max : 64H
function BrightnessMsg(data: number) {
    return BaseMsg('k', Commands.Brightness, data);
}

//Data Min : 00H ~ Max : 64H
function ColorMsg(data: number) {
    return BaseMsg('k', Commands.Colour, data);
}

//Data Red: 00H ~ Green: 64H
function TintMsg(data: number) {
    return BaseMsg('k', Commands.Tint, data);
}

//Data Min : 00H ~ Max : 64H
function SharpnessMsg(data: number) {
    return BaseMsg('k', Commands.Sharpness, data);
}

//Data 0 : OSD Off 1 : OSD On
enum OSDSelectOptions {
    OSDOff = 0,
    OSDOn = 1
}
function OSDSelectMsg(data: OSDSelectOptions) {
    return BaseMsg('k', Commands.OSDSelect, data);
}

// Data 0 : Off 1 : On
enum RemoteLockOptions {
    Off = 0,
    On = 1
}
function RemoteLockMsg(data: RemoteLockOptions) {
    return BaseMsg('k', Commands.RemoteLock, data);
}

//Data Min : 00H ~ Max : 64H
function BalanceMsg(data: number) {
    return BaseMsg('k', Commands.Balance, data);
}

// Data 0 : Normal
// 1 : Cool
// 2 : Warm
// 3 : User 
enum ColourTemperatureOptions {
    Normal = 0,
    Cool = 1,
    Warn = 2,
    User = 3
}
function ColorTemperatureMsg(data: ColourTemperatureOptions) {
    return BaseMsg('k', Commands.ColourTemperature, data);
}

enum KeyCodeOptions {
    Power = 0x08,

    Energy = 0x95,
    AV = 0x30,
    INPUT = 0x0B,
    TV_RAD = 0xF0,

    _0 = 0x10,
    _1 = 0x11,
    _2 = 0x12,
    _3 = 0x13,
    _4 = 0x14,
    _5 = 0x15,
    _6 = 0x16,
    _7 = 0x17,
    _8 = 0x18,
    _9 = 0x19,

    LIST = 0x53,
    Q_VIEW = 0x1A,
    VOL_Pos = 0x02,
    VOL_Neg = 0x03,
    FAV = 0x1E,
    RATIO = 0x79,
    MUTE = 0x09,
    CH_Pos = 0x00,
    CH_Neg = 0x01,

    MENU = 0x43,
    HOME = 0x23,// (keep pressed 5sec)
    WIDGETS = 0x58,// (only US models)
    NETCAST = 0x59,
    Q_MENU = 0x45,
    _3D = 0xDC,

    RIGHT = 0x06,
    LEFT = 0x07,
    UP = 0x40,
    DOWN = 0x41,

    OK = 0x44,

    BACK = 0x28,
    GUIDE = 0xA9,
    EXIT = 0x5B,

    RED = 0x72,
    GREEN = 0x71,
    YELLOW = 0x63,
    BLUE = 0x61,
    _3D_setup = 0x61,

    TEXT = 0x20,
    T_OPT = 0x21,
    SUBTIT = 0x39,

    LIVE_TV = 0x9E, //(for DVR to return to live feed if paused or re-winded)
    REC = 0xBD, //(only on DVR models)
    STOP = 0xB1,
    PLAY = 0xB0,
    PAUSE = 0xBA,
    RWD = 0x8F,
    FWD = 0x8E,
    SIMPLNK = 0x7E,
    INFO = 0xAA,
    AD = 0x91,
    APP = 0x9F
}
function KeyCodeMsg(data: KeyCodeOptions) {
    return BaseMsg('m', Commands.KeyCode, data);
}
