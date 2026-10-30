import crud

store = {}
inv = crud.create_invoice(store, {"total": 10})
pay = crud.create_payment(store, {"amount": 10})
assert crud.delete_payment(store, pay["id"]) is True
assert crud.get_payment(store, pay["id"]) is None
assert crud.get_invoice(store, inv["id"]) == {"total": 10, "id": 1}
assert crud.delete_payment(store, 99) is False
assert crud.delete_invoice(store, inv["id"]) is True
assert crud.list_invoices(store) == []
print("ok")
