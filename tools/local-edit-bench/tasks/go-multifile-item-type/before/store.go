package catalog

import "sort"

type Store struct {
	items map[string]Item
}

func NewStore() *Store {
	return &Store{items: map[string]Item{}}
}

func (s *Store) Put(it Item) {
	s.items[it.SKU] = it
}

func (s *Store) Get(sku string) (Item, bool) {
	it, ok := s.items[sku]
	return it, ok
}

func (s *Store) All() []Item {
	out := make([]Item, 0, len(s.items))
	for _, it := range s.items {
		out = append(out, it)
	}
	sort.Slice(out, func(a, b int) bool { return out[a].SKU < out[b].SKU })
	return out
}

func Seed(s *Store) {
	s.Put(NewItem("A-1", "Anvil", 4999))
	s.Put(NewItem("B-2", "Bucket", 799))
}
