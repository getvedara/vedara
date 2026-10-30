package people

const AdultAge = 18

func IsAdult(age int) bool {
	return age > AdultAge
}

func IsSenior(age int) bool {
	return age >= 65
}
