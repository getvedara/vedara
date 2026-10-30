package catalog

type Item struct {
	SKU   string
	Name  string
	Cents int
}

func NewItem(sku, name string, cents int) Item {
	return Item{SKU: sku, Name: name, Cents: cents}
}

func (i Item) Discounted(percent int) Item {
	i.Cents = i.Cents * (100 - percent) / 100
	return i
}
