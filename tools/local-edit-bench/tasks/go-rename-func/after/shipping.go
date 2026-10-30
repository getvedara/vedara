package shop

// ShippingCost returns the shipping cost in cents for a parcel.
func ShippingCost(weightGrams int, express bool) int {
	cost := 499
	if weightGrams > 1000 {
		cost += (weightGrams - 1000) / 500 * 150
	}
	if express {
		cost *= 2
	}
	return cost
}

// OrderTotal returns the order total in cents including shipping.
func OrderTotal(itemsCents int, weightGrams int, express bool) int {
	if itemsCents >= 5000 && !express {
		return itemsCents
	}
	return itemsCents + ShippingCost(weightGrams, express)
}
