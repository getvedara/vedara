package catalog

import "sort"

type Store struct {
	items map[string]Product
}

func NewStore() *Store {
	return &Store{items: map[string]Product{}}
}

func (s *Store) Put(it Product) {
	s.items[it.SKU] = it
}

func (s *Store) Get(sku string) (Product, bool) {
	it, ok := s.items[sku]
	return it, ok
}

func (s *Store) All() []Product {
	out := make([]Product, 0, len(s.items))
	for _, it := range s.items {
		out = append(out, it)
	}
	sort.Slice(out, func(a, b int) bool { return out[a].SKU < out[b].SKU })
	return out
}

func Seed(s *Store) {
	s.Put(NewProduct("A-1", "Anvil", 4999))
	s.Put(NewProduct("B-2", "Bucket", 799))
}
