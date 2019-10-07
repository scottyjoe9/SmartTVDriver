from lg_tv_device import LgTvDevice
from mqtt_device import MqttDevice
from mqtt_device import Topic

tv = LgTvDevice("/dev/ttyUSB0")
mqtt_tv = MqttDevice("mqtt-server", 1883, "gBridge/u2942/", "lg-tv", [Topic("power", True)])

def state_change(newState: str):
    print("New state: " + newState)
    mqtt_tv.publish(Topic("POWER", False), newState)

def power_command_received(topic: str, message: str):
    print("topic: " + topic + " message: " + message)
    tv.execute_command(topic, message)

tv.subscribe(state_change)
mqtt_tv.subscribe(power_command_received)

mqtt_tv.start()


