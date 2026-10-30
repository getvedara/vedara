#[derive(Debug, PartialEq)]
pub enum ParseError {
    MissingField(&'static str),
    BadNumber(String),
}

fn field<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    line.split(';').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        if k.trim() == key { Some(v.trim()) } else { None }
    })
}

fn number(line: &str, key: &'static str) -> Result<u32, ParseError> {
    let raw = field(line, key).ok_or(ParseError::MissingField(key))?;
    raw.parse::<u32>().map_err(|_| ParseError::BadNumber(raw.to_string()))
}

#[derive(Debug, PartialEq)]
pub struct Account {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_account(line: &str) -> Result<Account, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Account { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Address {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_address(line: &str) -> Result<Address, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Address { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Invoice {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_invoice(line: &str) -> Result<Invoice, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Invoice { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Payment {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_payment(line: &str) -> Result<Payment, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Payment { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Shipment {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_shipment(line: &str) -> Result<Shipment, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Shipment { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Warehouse {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_warehouse(line: &str) -> Result<Warehouse, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Warehouse { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Product {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_product(line: &str) -> Result<Product, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Product { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Supplier {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_supplier(line: &str) -> Result<Supplier, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Supplier { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Customer {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_customer(line: &str) -> Result<Customer, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Customer { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Order {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_order(line: &str) -> Result<Order, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Order { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Refund {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_refund(line: &str) -> Result<Refund, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Refund { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Coupon {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_coupon(line: &str) -> Result<Coupon, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Coupon { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Review {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_review(line: &str) -> Result<Review, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Review { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Category {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_category(line: &str) -> Result<Category, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Category { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Carrier {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_carrier(line: &str) -> Result<Carrier, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Carrier { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Pallet {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_pallet(line: &str) -> Result<Pallet, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Pallet { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Route {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_route(line: &str) -> Result<Route, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Route { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Driver {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_driver(line: &str) -> Result<Driver, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Driver { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Vehicle {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_vehicle(line: &str) -> Result<Vehicle, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Vehicle { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Station {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_station(line: &str) -> Result<Station, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Station { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Ticket {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_ticket(line: &str) -> Result<Ticket, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Ticket { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Agent {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_agent(line: &str) -> Result<Agent, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Agent { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Queue {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_queue(line: &str) -> Result<Queue, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Queue { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Region {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_region(line: &str) -> Result<Region, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Region { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Store {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_store(line: &str) -> Result<Store, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Store { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Shelf {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_shelf(line: &str) -> Result<Shelf, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Shelf { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Batch {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_batch(line: &str) -> Result<Batch, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Batch { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Lot {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_lot(line: &str) -> Result<Lot, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Lot { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Contract {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_contract(line: &str) -> Result<Contract, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Contract { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Quote {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_quote(line: &str) -> Result<Quote, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Quote { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Budget {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_budget(line: &str) -> Result<Budget, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Budget { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Ledger {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_ledger(line: &str) -> Result<Ledger, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Ledger { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Receipt {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_receipt(line: &str) -> Result<Receipt, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Receipt { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Voucher {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_voucher(line: &str) -> Result<Voucher, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Voucher { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Tariff {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_tariff(line: &str) -> Result<Tariff, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Tariff { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Parcel {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_parcel(line: &str) -> Result<Parcel, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Parcel { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Manifest {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_manifest(line: &str) -> Result<Manifest, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Manifest { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Depot {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_depot(line: &str) -> Result<Depot, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Depot { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Zone {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_zone(line: &str) -> Result<Zone, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Zone { id, width, height, weight })
}

#[derive(Debug, PartialEq)]
pub struct Bin {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub weight: u32,
}

pub fn parse_bin(line: &str) -> Result<Bin, ParseError> {
    let id = number(line, "id")?;
    let width = number(line, "width")?;
    let height = number(line, "height")?;
    let weight = number(line, "weight")?;
    Ok(Bin { id, width, height, weight })
}
