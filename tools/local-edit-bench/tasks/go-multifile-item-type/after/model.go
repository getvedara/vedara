package catalog

type Product struct {
	SKU   string
	Name  string
	Cents int
}

func NewProduct(sku, name string, cents int) Product {
	return Product{SKU: sku, Name: name, Cents: cents}
}

func (i Product) Discounted(percent int) Product {
	i.Cents = i.Cents * (100 - percent) / 100
	return i
}
