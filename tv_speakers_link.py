from mqtt_device import MqttDevice
from mqtt_device import Topic

mqtt_tv = MqttDevice("mqtt-server", 1883, "gBridge/u2942/", "lg-tv", [Topic("POWER", False)])
mqtt_speakers = MqttDevice("mqtt-server", 1883, "gBridge/u2942/", "sonoff-2275", [])

def tv_state_changed(topic: str, message: str):
    try:
    	print("state change: " + topic + " : " + message)
    	mqtt_speakers.publish(Topic(topic.lower(), True), message.lower())
    except:
        print("exception occurred during state change handling!!")

mqtt_tv.subscribe(tv_state_changed)

print("starting mqtt speakers loop")
mqtt_speakers.startAsync()

print("starting mqtt tv loop")
mqtt_tv.start()
