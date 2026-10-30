package api

import (
	"net/http"
	"strconv"
)

type Page struct {
	Offset int
	Size   int
}

func parsePage(r *http.Request, defaultSize int) Page {
	size, err := strconv.Atoi(r.URL.Query().Get("size"))
	if err != nil || size <= 0 {
		size = defaultSize
	}
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	return Page{Offset: offset, Size: size}
}

// HandleListAccounts lists accounts.
func HandleListAccounts(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("account", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetAccount returns one account.
func HandleGetAccount(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("account", id)
		if !ok {
			http.Error(w, "account not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListAddresss lists addresss.
func HandleListAddresss(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("address", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetAddress returns one address.
func HandleGetAddress(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("address", id)
		if !ok {
			http.Error(w, "address not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListInvoices lists invoices.
func HandleListInvoices(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("invoice", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetInvoice returns one invoice.
func HandleGetInvoice(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("invoice", id)
		if !ok {
			http.Error(w, "invoice not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListPayments lists payments.
func HandleListPayments(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("payment", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetPayment returns one payment.
func HandleGetPayment(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("payment", id)
		if !ok {
			http.Error(w, "payment not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListShipments lists shipments.
func HandleListShipments(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("shipment", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetShipment returns one shipment.
func HandleGetShipment(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("shipment", id)
		if !ok {
			http.Error(w, "shipment not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListWarehouses lists warehouses.
func HandleListWarehouses(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("warehouse", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetWarehouse returns one warehouse.
func HandleGetWarehouse(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("warehouse", id)
		if !ok {
			http.Error(w, "warehouse not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListProducts lists products.
func HandleListProducts(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("product", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetProduct returns one product.
func HandleGetProduct(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("product", id)
		if !ok {
			http.Error(w, "product not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListSuppliers lists suppliers.
func HandleListSuppliers(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("supplier", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetSupplier returns one supplier.
func HandleGetSupplier(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("supplier", id)
		if !ok {
			http.Error(w, "supplier not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListCustomers lists customers.
func HandleListCustomers(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("customer", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetCustomer returns one customer.
func HandleGetCustomer(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("customer", id)
		if !ok {
			http.Error(w, "customer not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListOrders lists orders.
func HandleListOrders(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("order", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetOrder returns one order.
func HandleGetOrder(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("order", id)
		if !ok {
			http.Error(w, "order not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListRefunds lists refunds.
func HandleListRefunds(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("refund", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetRefund returns one refund.
func HandleGetRefund(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("refund", id)
		if !ok {
			http.Error(w, "refund not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListCoupons lists coupons.
func HandleListCoupons(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("coupon", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetCoupon returns one coupon.
func HandleGetCoupon(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("coupon", id)
		if !ok {
			http.Error(w, "coupon not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListReviews lists reviews.
func HandleListReviews(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("review", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetReview returns one review.
func HandleGetReview(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("review", id)
		if !ok {
			http.Error(w, "review not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListCategorys lists categorys.
func HandleListCategorys(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("category", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetCategory returns one category.
func HandleGetCategory(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("category", id)
		if !ok {
			http.Error(w, "category not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListCarriers lists carriers.
func HandleListCarriers(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("carrier", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetCarrier returns one carrier.
func HandleGetCarrier(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("carrier", id)
		if !ok {
			http.Error(w, "carrier not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListPallets lists pallets.
func HandleListPallets(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("pallet", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetPallet returns one pallet.
func HandleGetPallet(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("pallet", id)
		if !ok {
			http.Error(w, "pallet not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListRoutes lists routes.
func HandleListRoutes(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("route", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetRoute returns one route.
func HandleGetRoute(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("route", id)
		if !ok {
			http.Error(w, "route not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListDrivers lists drivers.
func HandleListDrivers(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("driver", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetDriver returns one driver.
func HandleGetDriver(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("driver", id)
		if !ok {
			http.Error(w, "driver not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListVehicles lists vehicles.
func HandleListVehicles(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("vehicle", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetVehicle returns one vehicle.
func HandleGetVehicle(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("vehicle", id)
		if !ok {
			http.Error(w, "vehicle not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListStations lists stations.
func HandleListStations(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("station", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetStation returns one station.
func HandleGetStation(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("station", id)
		if !ok {
			http.Error(w, "station not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListTickets lists tickets.
func HandleListTickets(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("ticket", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetTicket returns one ticket.
func HandleGetTicket(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("ticket", id)
		if !ok {
			http.Error(w, "ticket not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListAgents lists agents.
func HandleListAgents(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("agent", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetAgent returns one agent.
func HandleGetAgent(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("agent", id)
		if !ok {
			http.Error(w, "agent not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListQueues lists queues.
func HandleListQueues(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("queue", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetQueue returns one queue.
func HandleGetQueue(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("queue", id)
		if !ok {
			http.Error(w, "queue not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListRegions lists regions.
func HandleListRegions(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("region", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetRegion returns one region.
func HandleGetRegion(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("region", id)
		if !ok {
			http.Error(w, "region not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListStores lists stores.
func HandleListStores(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("store", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetStore returns one store.
func HandleGetStore(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("store", id)
		if !ok {
			http.Error(w, "store not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListShelfs lists shelfs.
func HandleListShelfs(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("shelf", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetShelf returns one shelf.
func HandleGetShelf(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("shelf", id)
		if !ok {
			http.Error(w, "shelf not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListBatchs lists batchs.
func HandleListBatchs(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("batch", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetBatch returns one batch.
func HandleGetBatch(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("batch", id)
		if !ok {
			http.Error(w, "batch not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListLots lists lots.
func HandleListLots(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("lot", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetLot returns one lot.
func HandleGetLot(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("lot", id)
		if !ok {
			http.Error(w, "lot not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListContracts lists contracts.
func HandleListContracts(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("contract", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetContract returns one contract.
func HandleGetContract(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("contract", id)
		if !ok {
			http.Error(w, "contract not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListQuotes lists quotes.
func HandleListQuotes(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("quote", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetQuote returns one quote.
func HandleGetQuote(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("quote", id)
		if !ok {
			http.Error(w, "quote not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListBudgets lists budgets.
func HandleListBudgets(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("budget", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetBudget returns one budget.
func HandleGetBudget(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("budget", id)
		if !ok {
			http.Error(w, "budget not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListLedgers lists ledgers.
func HandleListLedgers(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("ledger", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetLedger returns one ledger.
func HandleGetLedger(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("ledger", id)
		if !ok {
			http.Error(w, "ledger not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListReceipts lists receipts.
func HandleListReceipts(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("receipt", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetReceipt returns one receipt.
func HandleGetReceipt(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("receipt", id)
		if !ok {
			http.Error(w, "receipt not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListVouchers lists vouchers.
func HandleListVouchers(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("voucher", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetVoucher returns one voucher.
func HandleGetVoucher(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("voucher", id)
		if !ok {
			http.Error(w, "voucher not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListTariffs lists tariffs.
func HandleListTariffs(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("tariff", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetTariff returns one tariff.
func HandleGetTariff(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("tariff", id)
		if !ok {
			http.Error(w, "tariff not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListParcels lists parcels.
func HandleListParcels(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("parcel", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetParcel returns one parcel.
func HandleGetParcel(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("parcel", id)
		if !ok {
			http.Error(w, "parcel not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListManifests lists manifests.
func HandleListManifests(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("manifest", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetManifest returns one manifest.
func HandleGetManifest(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("manifest", id)
		if !ok {
			http.Error(w, "manifest not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListDepots lists depots.
func HandleListDepots(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("depot", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetDepot returns one depot.
func HandleGetDepot(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("depot", id)
		if !ok {
			http.Error(w, "depot not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListZones lists zones.
func HandleListZones(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("zone", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetZone returns one zone.
func HandleGetZone(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("zone", id)
		if !ok {
			http.Error(w, "zone not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

// HandleListBins lists bins.
func HandleListBins(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pageSize := 20
		page := parsePage(r, pageSize)
		rows, err := store.List("bin", page.Offset, page.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// HandleGetBin returns one bin.
func HandleGetBin(store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		row, ok := store.Get("bin", id)
		if !ok {
			http.Error(w, "bin not found", http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}
