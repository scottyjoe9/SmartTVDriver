from serial import Serial
from enum import Enum
from apscheduler.schedulers.background import BackgroundScheduler
from threading import Lock

class Command(Enum):
	POWER = "a"

class PowerState(Enum):
	ON = 0x01
	OFF = 0x00
	STATUS = 0xFF

class LgTvDevice:
	__scheduler = BackgroundScheduler()
	state: PowerState = PowerState.OFF
	__subscriptions = []
	__serial = None
	__job = None
	__lock = Lock()

	def __init__(self, serialName):
		self.__serial = Serial.Serial(serialName, 9600, 8, Serial.PARITY_NONE,
                Serial.STOPBITS_ONE, xonxoff=0, rtscts=0, timeout=1)
		job = self.__scheduler.add_job(self.__get_tv_status, 'interval', seconds=2)
		self.__scheduler.start()

	def subscribe(self, subscription):
		self.__lock.acquire()
		self.__subscriptions.append(subscription)
		self.__lock.release()

	def execute_command(self, command: str, newState: str):
		try:
			command = command.upper()
			newState = newState.upper()
			if newState.isdigit():
				powerState = PowerState(int(newState))
			else:
				powerState = PowerState[newState]

			if Command[command] == Command.POWER:
				self.__power_command(powerState)
		except:
			print("Error occurred")

	def __change_state(self, newState: PowerState):
		if self.state == newState:
			return

		self.state = newState
		for subscription in self.__subscriptions:
			subscription(newState.name)

	def __get_tv_status(self):
		self.__lock.acquire()
		self.__power_command(PowerState.STATUS)
		self.__parse_message(self.__read_message())
		self.__lock.release()

	def __power_command(self, state: PowerState):
		self.__serial.write(self.__base_message("k", Command.POWER.value, state.value))

	def __read_message(self) -> str:
		try:
			return self.__serial.readline().decode("utf-8")
		except:
			return ""

	def __base_message(self, base: str, command: str, data: int):
		if data is None:
			raise Exception("data is not defined!")

		return (base + command + " 01 " + ("%X" % data) + "\r").encode('utf-8')

	def __parse_message(self, message: str):
		if message.count == 0 or not message.endswith("x"):
			return

		tokens = message.split()
		command = tokens[0]
		data = tokens[2][2:4]

		if(command == Command.POWER.value):
			self.__change_state(PowerState.OFF if int(data) == 0 else PowerState.ON)

