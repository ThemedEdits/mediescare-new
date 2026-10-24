# Moving data from another pharmacy program

A one-time move into a new Mediescare organisation, done before the shop starts using Mediescare.

## 1. Prepare the folder

Export from the old program and save one file per kind of data in one folder. Each file can be CSV, TXT (tab
separated), XLSX, XLS, JSON (a list of objects) or XML. Name the files:

| File name | What it holds | Needed columns |
|---|---|---|
| `organisation.json` | the new organisation and its owner | see the example |
| `products.*` | medicines and products | Brand name (and Units in one pack, MRP per pack, Barcode, SKU as available) |
| `suppliers.*` | suppliers | Company name; optional Opening balance owed |
| `customers.*` | customers | Name; optional Phone, Credit limit, Opening balance owed to us |
| `opening_stock.*` | batches on the shelf now | Product (SKU, barcode or exact name), Batch number, Expiry date, Quantity in packs, Cost per pack |

Column names are matched without caring about case, spaces or punctuation. They are the same names as on the
**Import data** screen, so download a template there to see every column. A complete example is in
`docs/legacy-sample/`.

## 2. Run

```
npm run migrate -- "D:\old-data" --out "D:\mediescare-data"
```

- Files are imported in this order: products, suppliers, customers, opening stock.
- Every row is checked first. If a file has a wrong row, nothing from that file is imported, and the row numbers and
  reasons are listed. Fix them and run again into a new, empty folder.
- Opening stock creates batches with their cost and MRP. Opening balances appear as "Opening balance" entries in
  the supplier and customer accounts.

## 3. Use the result

1. On the Head Office computer, install Mediescare but do not start it.
2. Copy the contents of the output folder to `%APPDATA%\Mediescare`.
3. Start Mediescare and sign in as the owner from `organisation.json`. Change that password at once.
4. Add branches and people as usual (see the admin guide). Branches join over the cloud and receive the master data.

The result is ordinary Mediescare data. Every imported record is in the audit log as an import by the owner.
