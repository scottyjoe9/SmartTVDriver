print("test")

from lg_tv_device import LgTvDevice
from mqtt_device import MqttDevice
from mqtt_device import Topic

print("LG TV Monitor Initialising...")

tv = LgTvDevice("/dev/ttyUSB0")
mqtt_tv = MqttDevice("mqtt-server", 1883, "gBridge/u2942/", "lg-tv", [Topic("power", True)])

def state_change(newState: str):
    print("TV State change received: New state: " + newState)
    mqtt_tv.publish(Topic("POWER", False), newState)

def power_command_received(topic: str, message: str):
    print("MQTT message received: topic: " + topic + " message: " + message)
    tv.execute_command(topic, message)

tv.subscribe(state_change)
mqtt_tv.subscribe(power_command_received)

print("LG TV Monitor Starting...")

mqtt_tv.start()


