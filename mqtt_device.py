import paho.mqtt.client as mqtt
import json
import threading

class Topic:
    def __init__(self, topic: str, isCommand: bool):
        self.topic = topic
        self.isCommand = isCommand

    topic: str
    isCommand: bool

class MqttDevice:
    __client: mqtt.Client
    __baseTopic: str
    __deviceName: str
    __topics: list
    __subscribers: list = []

    def __init__(self, host: str, port: int, baseTopic: str, deviceName: str, topics: list):
        self.__baseTopic = baseTopic
        self.__deviceName = deviceName
        self.__topics = topics

        self.__client = mqtt.Client()
        res = self.__client.connect(host, port)
        print("connected with res: " + str(res))
        self.__client.on_connect = self.__on_mqtt_connect
        self.__client.on_message = self.__on_mqtt_message
        #lambda client, userdata, msg: self.__on_mqtt_message(client, userdata, msg)

    def subscribe(self, subscriber):
        self.__subscribers.append(subscriber)

    def publish(self, topic: Topic, message: str):
        fullTopic = self.__create_full_topic_string(topic)
        print("publishing " + message + " to " + fullTopic)
        self.__client.publish(fullTopic, message)

    def startAsync(self):
        threading.Thread(target=self.start).start()

    def start(self):
        self.__client.loop_forever()

    def __on_mqtt_connect(self, client, userdata, flags, rc):
        try:
            print("Connected!")
            for topic in self.__topics:
                fullTopic = self.__create_full_topic_string(topic)
                print("subscribing to " + fullTopic)
                self.__client.subscribe(fullTopic)
        except:
            print("__on_mqtt_connect exception occurred")

    def __on_mqtt_message(self, client, userdata, msg):
        try:
            message = str(msg.payload.decode("utf-8"))
            topic = str(msg.topic).split("/").pop()
            self.__signal_subscribers(topic, message)
        except:
            print("__on_mqtt_message exception occurred")

    def __signal_subscribers(self, topic: str, message: str):
        if len(self.__subscribers) > 0:
            for subscriber in self.__subscribers:
                subscriber(topic, message)

    def __create_full_topic_string(self, topic: Topic) -> str:
        return self.__baseTopic + self.__get_message_type(topic) + "/" + self.__deviceName + "/" + topic.topic

    def __get_message_type(self, topic: Topic) -> str:
        return ("cmnd" if topic.isCommand else "stat")
