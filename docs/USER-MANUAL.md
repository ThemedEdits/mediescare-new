# Mediescare User Manual

For everyone who uses Mediescare: owners, branch managers, pharmacists, cashiers, store keepers and accountants.
It explains every screen, step by step. You do not need to read it all at once. Use the contents list to jump to
the part you need.

---

## Contents

1. [What Mediescare is](#1-what-mediescare-is)
2. [Words used in this manual](#2-words-used-in-this-manual)
3. [Installing Mediescare](#3-installing-mediescare)
4. [First start: setting up the organisation](#4-first-start-setting-up-the-organisation)
5. [Joining a branch computer](#5-joining-a-branch-computer)
6. [Signing in and out](#6-signing-in-and-out)
7. [The screen: top bar, menu, search, bell](#7-the-screen-top-bar-menu-search-bell)
8. [Who can do what (roles)](#8-who-can-do-what-roles)
9. [A normal day](#9-a-normal-day)
10. [Point of sale (the counter)](#10-point-of-sale-the-counter)
11. [Sales and receipts](#11-sales-and-receipts)
12. [Cashier shifts](#12-cashier-shifts)
13. [Customers](#13-customers)
14. [Controlled drugs and prescriptions](#14-controlled-drugs-and-prescriptions)
15. [Medicines and products](#15-medicines-and-products)
16. [Lists and categories](#16-lists-and-categories)
17. [Batches and expiry](#17-batches-and-expiry)
18. [Stock movements](#18-stock-movements)
19. [Stock adjustments](#19-stock-adjustments)
20. [Stock take](#20-stock-take)
21. [Transfers between branches](#21-transfers-between-branches)
22. [Reorder list, stock value and movers](#22-reorder-list-stock-value-and-movers)
23. [Barcode labels](#23-barcode-labels)
24. [Importing data](#24-importing-data)
25. [Suppliers](#25-suppliers)
26. [Purchase orders](#26-purchase-orders)
27. [Goods received](#27-goods-received)
28. [Returns to suppliers](#28-returns-to-suppliers)
29. [Supplier payments](#29-supplier-payments)
30. [Dashboard](#30-dashboard)
31. [All branches](#31-all-branches)
32. [Reports](#32-reports)
33. [Financial journal](#33-financial-journal)
34. [Expenses](#34-expenses)
35. [Petty cash](#35-petty-cash)
36. [Approvals](#36-approvals)
37. [Notifications (the bell)](#37-notifications-the-bell)
38. [Global search](#38-global-search)
39. [Keyboard shortcuts](#39-keyboard-shortcuts)
40. [Branches](#40-branches)
41. [Users](#41-users)
42. [Roles and permissions](#42-roles-and-permissions)
43. [Computers, join codes and the recovery key](#43-computers-join-codes-and-the-recovery-key)
44. [Settings](#44-settings)
45. [Sync](#45-sync)
46. [Backups](#46-backups)
47. [Receipt printer](#47-receipt-printer)
48. [Audit log](#48-audit-log)
49. [My profile](#49-my-profile)
50. [Help and updates](#50-help-and-updates)
51. [Exporting and printing lists](#51-exporting-and-printing-lists)
52. [Working without internet](#52-working-without-internet)
53. [Problems and answers](#53-problems-and-answers)

---

## 1. What Mediescare is

Mediescare runs a pharmacy chain: one Head Office and its branches. With it you:

- **Sell** at the counter, quickly, with a barcode scanner and the keyboard.
- **Keep stock** by batch and expiry date. The medicine that expires first is sold first.
- **Buy** from suppliers and pay them.
- **Move stock** from Head Office to branches.
- **Keep money records:** cash, card, Easypaisa, JazzCash, bank, customer credit, expenses and petty cash.
- **Keep records the law asks for:** prescriptions and the controlled drug register.
- **See reports and dashboards** for each branch and for all branches together.

Every computer keeps its own copy of the data, so selling never stops when the internet or the network is down.
When the connection comes back, computers share what changed (this is called **sync**).

Nothing important is ever deleted. A wrong bill, payment or expense is **cancelled**: the original stays in the
records and the cancellation is recorded next to it, with who did it and why.

---

## 2. Words used in this manual

| Word | Meaning |
|---|---|
| **Head Office** | The main office. It buys most stock and sends it to branches. |
| **Branch** | A shop. Each branch has its own stock, cash, customers' balances and reports. |
| **Main computer** | The first computer of a branch. It shares data with the other computers of the branch and with the cloud. |
| **Extra computer** | Any other computer in the same branch (for example a second counter). It shares data through the main computer. |
| **Batch** | One lot of a medicine with one batch number, expiry date, cost and MRP. |
| **FEFO** | First expiry, first out. Mediescare sells and sends the batch that expires first. |
| **Base unit** | The smallest unit: tablet, capsule, ml or piece. All stock is counted in base units. |
| **Pack** | The unit you buy in (for example a strip of 10 tablets). Prices and costs are per pack. |
| **MRP** | The selling price per pack printed on the medicine. |
| **Trade price / cost** | What the pharmacy paid per pack. Only roles with "See purchase cost and profit" can see it. |
| **Shift** | One cashier's working time at one computer, from opening to closing the cash drawer. |
| **Sync** | Sharing changes between computers and the cloud. |
| **Cancel** | Undo a document by adding a cancellation. The original is kept. |

---

## 3. Installing Mediescare

1. Run `Mediescare-Setup-<version>.exe`.
2. Choose who it is for:
   - **Anyone who uses this computer (all users):** choose this on the main computer of each branch. It lets the
     installer open the Windows Firewall for the shop network.
   - **Only for me:** fine on extra computers.
3. Choose the folder (the suggested one is fine) and finish. A desktop shortcut and a Start menu entry are made.
4. Windows may show a blue "Windows protected your PC" message. Choose **More info**, then **Run anyway**.
   This happens because the installer is not yet signed with a company certificate.

Your data is stored in `%APPDATA%\Mediescare` for the Windows user. Uninstalling the app keeps the data.

---

## 4. First start: setting up the organisation

Do this **once**, on the first Head Office computer. The person doing it becomes the **owner** (Super Admin).

1. Start Mediescare. Choose **Create a new Head Office**.
2. **Step 1:** fill in the organisation:
   - **Organisation name**, for example "Shifa Pharmacy".
   - **Organisation code**, 3 to 12 letters or numbers, for example "SHIFA". Branches need this code to join, so
     keep it.
3. **Step 2:** fill in the Head Office:
   - Name and code (for example "HO"), address, phone and drug sale licence number. These print on receipts.
4. **Step 3:** fill in your own account:
   - Full name, username and password (at least 8 characters), and the password again.
   - The computer name (the suggested one is fine).
5. Press **Create Head Office**.
6. **The recovery key appears.** Write it down on paper and keep it somewhere safe, away from the computer.
   - It is shown only now.
   - If the Head Office computer is ever lost or broken, a new computer joins as Head Office with the organisation
     code and this key, and all data comes back from the cloud.
   - Tick **I have written the recovery key down**, then press **Continue**.

You are now signed in. The Home page shows the next steps: add branches, add users, check roles and settings.

---

## 5. Joining a branch computer

### The main computer of a new branch

**At Head Office:**

1. Add the branch (**Branches**, then **Add branch**). This also makes the branch manager's account. Give the
   manager the temporary password shown.
2. Open **Computers**, then **New join code**. Choose the branch and press **Make the code**.
3. Give the person at the branch two things (by phone is fine):
   - the **organisation code**
   - the **join code**, for example `K7QM-4XPA-9RTD`

   The join code works **once**, for **24 hours**. The Head Office computer must be online so the code reaches the
   cloud.

**At the branch:**

1. Install and start Mediescare. Choose **Sign in to an existing Head Office or branch**.
2. Choose **The main computer of the branch**.
3. Type the **organisation code** and the **join code**.
4. Type the **branch manager's username and password** (the temporary one is fine).
5. Press **Connect this computer**. The branch's data downloads (it may take a few minutes the first time). The
   manager is then signed in and asked to choose a new password.

If the username or password was wrong, the computer is still joined (the data is there). A message says so. Press
**Go to sign in** and sign in normally.

### An extra computer in a branch (second counter)

1. **On the main computer:** open **Sync** and press **Add a computer**. A 6-digit pairing code appears for
   10 minutes.
2. **On the new computer:** install and start Mediescare, choose **Sign in to an existing Head Office or branch**,
   then **An extra computer in the branch**.
3. Press **Find the main computer on this network** and pick it from the list, or type its address (shown on the main computer's
   Sync page).
4. Type the **pairing code** and a manager's username and password.
5. Press **Connect this computer**.

Both computers must be on the same shop network (the same router or Wi-Fi).

### A new Head Office computer (the old one is lost)

1. Install Mediescare. Choose **Sign in to an existing Head Office or branch**, then **The main computer of the
   branch**.
2. Type the organisation code, tick **This is a new Head Office computer (the old one is lost): use the recovery
   key**, and type the recovery key.
3. Type the owner's username and password. Press **Connect this computer**.

---

## 6. Signing in and out

- **Sign in:** type your username and password and press **Sign in**. Everyone has their own account. Never share
  accounts: every action is saved with your name.
- **First sign-in:** a new user (or one whose password was reset) must choose a new password first.
- **Wrong password:** after 5 wrong tries the account locks for 15 minutes. A manager can unlock it from **Users**.
- **Sign out:** press the sign-out icon at the top right, or **Ctrl+Shift+L**.
- **Automatic sign-out:** if nobody uses the screen for 30 minutes (a setting), Mediescare signs you out. Your work
  is saved. Sign in again to continue.
- **Change your password:** **My profile**, then **Change password**.

---

## 7. The screen: top bar, menu, search, bell

**Top bar (left to right):**

- **Search box** (or **Ctrl+K**): find anything (see [Global search](#38-global-search)).
- **Branch:** the branch you are working in. People allowed to switch branches click it to choose another.
- **Sync:** shows whether this computer is up to date with the others ("Up to date", "Offline", "Not set up", or an
  error). A number in brackets means changes are waiting to be sent. Click it for details.
- **Backup:** when the last backup was made. Red means no recent backup.
- **Bell:** notifications. A red number means new ones. See [Notifications](#37-notifications-the-bell).
- **Your name and role:** click it for My profile, Keyboard shortcuts and Sign out.

**Menu (left side):** you see only the pages your role allows. Groups:

- Main
- Selling
- Inventory
- Purchasing
- Money and reports
- Administration

The icon at the top of the menu makes it narrow or wide.

**Lists (tables):** most pages show a table:

- Type in the search box above the table to filter it.
- Click a column heading to sort by it.
- **Columns** chooses which columns to show.
- Change the number of rows per page at the bottom.
- Click a row to open it.

**Messages:** small messages appear at the bottom right after saving. If something is wrong, the message says what
to do in plain words, under the field to correct.

---

## 8. Who can do what (roles)

Six roles come ready made. Managers can change them (see [Roles and permissions](#42-roles-and-permissions)).

| Role | Usually does |
|---|---|
| **Super Admin** (owner) | Everything, in every branch. |
| **Branch Admin** (branch manager) | Runs one branch: staff, stock, sales, purchases, expenses, approvals, reports. |
| **Pharmacist** | Sells, checks prescriptions and controlled drugs, takes returns, sells on credit. |
| **Cashier** | Sells at the counter and handles the cash drawer. |
| **Store Keeper** | Receives goods, keeps batches and expiry in order, adjusts stock, handles transfers. |
| **Accountant** | Sales records, customer and supplier accounts, supplier payments, expenses, financial reports. |

Only roles with **See purchase cost and profit** see costs, trade prices and profit. For everyone else these are
hidden everywhere, including exports.

---

## 9. A normal day

**Cashier or pharmacist:**

1. Sign in, then open **Point of sale**.
2. Count the cash in the drawer and open your shift.
3. Sell all day.
4. At the end: **Cashier shifts**, open your shift, **Close shift**, count the cash and type it in.

**Branch manager:**

1. **Dashboard:** today's sales by cash, card, online and credit, plus what needs attention.
2. **Bell:** low stock, expiring batches, overdue customers and suppliers, approvals waiting.
3. **Approvals:** decide what waits for you.
4. **Cashier shifts:** read the note of any shift where the cash did not match.
5. Check that the top bar says **Up to date** and that there is a backup from today.

**Store keeper:**

1. **Goods received:** receive today's deliveries.
2. **Transfers:** receive stock sent by Head Office.
3. **Batches and expiry:** deal with expiring or expired batches.
4. **Reorder list:** see what to order.

---

## 10. Point of sale (the counter)

Open **Point of sale**. Everything can be done with the keyboard and a barcode scanner. The default keys are below
(each person can change them, see [Keyboard shortcuts](#39-keyboard-shortcuts)).

| Key | Action |
|---|---|
| F2 | Find a medicine |
| F3 | Choose the customer |
| F4 | Change the quantity of the selected line |
| F6 | Bill discount |
| F8 | Put the bill on hold |
| F9 | Bills on hold |
| F10 | Take payment |
| Delete | Remove the selected line |
| Ctrl+N | New bill |
| Ctrl+P | Reprint the last receipt |
| Up / Down arrows | Move between lines |

### 10.1 Opening your shift

The first time you open the counter, Mediescare asks you to count the cash in the drawer. Type the amount and press
**Open shift**. Selling needs your own open shift (a setting). Only one shift can be open on a computer at a time.

### 10.2 Adding medicines to the bill

- **Scan the barcode.** The medicine is added at once.
- Or press **F2** and type part of the **brand name**, the **generic name (salt)** or the **SKU**, then press
  **Enter** or click it.
- Each result shows the stock on hand and the MRP. "Rx" or "Controlled" marks medicines that need a prescription.
- **Substitutes:** when a medicine is out of stock, Mediescare suggests others with the same salt.

### 10.3 Units, quantity and batch

- **Unit:** choose tablet, strip or box (or the units set for that product). The price changes with the unit.
- **Quantity:** type it, or press **F4**.
- **Batch:** Mediescare picks the batch that expires first. If one batch has too little, the line is split over
  two batches. You may choose another batch from the line. A batch close to expiry is marked so you can tell the
  customer.
- Expired and quarantined batches are never sold.

### 10.4 Discounts and price changes

- **Line discount:** type a percentage on the line.
- **Bill discount:** press **F6** and type a percentage or an amount. It is spread over the lines so they add up to
  the total exactly.
- A discount above the limit (10% by default, or the customer's usual discount) needs a manager. So does typing a
  different price.

### 10.5 Customer and credit

- Press **F3** and search by name, phone, code or CNIC, or add a new customer.
- **Walk-in customers** (no customer chosen) always pay the full amount.
- **On account (credit):** choose a customer who has a credit limit. The unpaid part goes on their account, within
  the limit. It needs the "Sell on credit" right or a manager's approval.
- The customer's usual discount is applied by itself.

### 10.6 Prescriptions

- A **prescription-only** medicine needs the patient's name and the doctor's name.
- A **controlled** medicine also needs the patient's CNIC, the doctor's PMDC number and the prescription number.
- Phone, address, clinic, prescription date and a photo of the prescription (under 1 MB) can be added.
- Prescriptions are kept for at least 5 years and never deleted.

### 10.7 Taking payment

1. Press **F10** (or **Pay**). The payment window shows the total.
2. Type the **cash received**. The change appears.
3. **Card, Easypaisa, JazzCash or bank:** add a line with the method and amount. Wallet and bank payments need the
   transaction number. Methods can be mixed.
4. Card and wallet payments cannot be more than the bill; only cash gives change.
5. Press **Finish sale**.

The receipt prints (if automatic printing is on). The screen shows the change and the bill number, for example
`INV-LHR1-0001`. Press **Next customer** or **Enter**.

### 10.8 Manager approval

When something needs a manager (a big discount, a changed price, credit, a large return, cancelling a bill, or a big
expense from the drawer), a window appears:

- **Manager is at the counter:** they type their own username and password, and a reason if needed. The approval
  is used once, for this bill only.
- **Manager is elsewhere:** press **Ask a manager on another computer** and keep the window open. The manager
  approves it on the **Approvals** page and your screen goes on by itself. If they reject it, the reason is shown.

Nobody can approve their own request.

### 10.9 Bills on hold

- **F8** puts the bill aside with a name to find it again (for example "man in grey shirt"). The counter is then
  free for the next customer.
- **F9** lists held bills. Choose one and press **Resume**. Prices and stock are checked again.
- Held bills stay on this computer only.

### 10.10 Other counter actions

- **New bill (Ctrl+N):** clears the bill (it asks first).
- **Reprint (Ctrl+P):** prints the last receipt again, marked COPY. It needs the reprint right.
- **Find a bill:** opens a bill by its number (or scan the barcode on the receipt) for a return or reprint.
- **Receive payment:** take money a customer owes. It goes to their oldest unpaid bills first.
- **Medicine labels:** print dosage labels for the lines of a bill.

### 10.11 Customer display

If a second screen is connected, the customer sees the lines and the total there. Turn it on in **Receipt printer**.

---

## 11. Sales and receipts

Lists every bill of the branch.

- **Filters:**
  - date range, status (completed or cancelled), payment method, cashier
  - with or without returns, minimum and maximum amount
- **Totals** at the top: number of bills, sales, discounts, credit, returns, and profit (if you may see it).
- **Open a bill:** its lines (with batch and expiry), discounts, tax, payments, returns, the customer, the patient
  and who approved anything.

**On a bill:**

- **View receipt:** see it on screen; print it, or save it as PDF.
- **Medicine labels:** print dosage labels.
- **Return items:**
  1. Choose the lines and how much comes back.
  2. Choose what happens to the stock:
     - **Back on the shelf:** it can be sold again.
     - **Damaged or Expired:** it comes back and is written off at once; both steps are visible.
     - **Quarantine:** it comes back and the whole batch is blocked at this branch.
  3. Choose how to pay back: cash, card, wallet, bank or the customer's account. If the customer still owed money
     on that bill, that is reduced first.
  4. Write the reason and confirm.

  A full return gives back exactly what was paid. Large returns need a manager.
- **Cancel bill:** cancels the whole bill. Stock goes back, the money is refunded from this computer's drawer, and
  the customer's account is corrected. It needs the "Cancel bill" right or a manager's approval. It is not possible
  once the bill has a return or a later payment (use a return instead).

---

## 12. Cashier shifts

- **List:** every shift with its cashier, times, sales and the difference found at closing.
- **X report:** the report of an open shift so far. **Z report:** the final report of a closed shift.

**Inside a shift:**

- **Cash in / Cash out:** money put into or taken from the drawer for something other than a sale (change from the
  bank, a payment to a delivery boy), with a reason. Expenses paid from the drawer and petty cash top-ups are
  recorded here by themselves.
- **Expected cash** = opening cash + cash sales + cash received from customers - cash refunds + cash in - cash out.
- **Close shift:**
  1. Count the drawer and type the amount.
  2. If it does not match, write a note explaining why.
  3. The difference (over or short) is saved.
- **Print:** prints the X or Z report on the receipt printer.

Cashiers see their own shifts; managers see everyone's.

---

## 13. Customers

Customers are shared by all branches. What they owe is kept per branch.

- **Add customer:**
  - name, phone, CNIC, address
  - credit limit (needs the credit right), usual discount (needs the discount right), notes
- **Open a customer:**
  - their details and current balance
  - their bills
  - the **statement** (every bill, payment and return with a running balance, for any period; print or export)
- **Receive payment:**
  1. Type the amount and the method.
  2. The money goes to the oldest unpaid bills first.
  3. With the "change the date" right, the date can be changed; a reason is logged.
- **Cancel a payment:** wrong payments are cancelled (with a reason), not deleted.
- **Deactivate:** stops a customer being chosen; their history stays.

---

## 14. Controlled drugs and prescriptions

Open **Controlled drugs and Rx**.

- **Controlled drug register:**
  - Every movement of each controlled medicine at this branch, in date order.
  - Shows quantity in and out and a running balance, plus the patient, doctor, PMDC number and prescription number
    for each sale.
  - It is built from the stock records, so it always matches the stock.
  - Filter by medicine and date. Print or export it for inspections.
- **Prescriptions:** every prescription captured at the counter. Search by patient, doctor or prescription number
  and open the photo.

---

## 15. Medicines and products

### 15.1 The list

Search by name, salt, SKU or barcode. Filter by category, status or stock level (low, out, over).

### 15.2 Adding a product

Press **Add product** and fill in:

| Field | What to type |
|---|---|
| Brand name | for example Panadol (required) |
| Generic name (salt) | for example Paracetamol (used for substitutes) |
| Strength, dosage form | 500mg, Tablet |
| Category, manufacturer, drug class, storage | chosen from lists (see [Lists and categories](#16-lists-and-categories)) |
| Smallest unit | Tablet, capsule, ml, piece |
| Pack unit and units in one pack | Strip of 10 tablets. Locked once the product has stock. |
| Extra units | for example Box = 100 tablets, with an optional fixed price |
| Barcodes | one or more (also per unit); a barcode can belong to one product only |
| MRP and trade price per pack | the default prices; each batch keeps its own |
| Tax rate % | most medicines 0; prices include tax |
| Prescription required / Controlled | controlled medicines are always prescription-only |
| Cold chain, DRAP registration number | for records and labels |
| Minimum, maximum, reorder level and reorder quantity | in the smallest unit; used by the reorder list and alerts |
| Default supplier, notes, picture | optional |

The SKU is made automatically if you leave it empty.

### 15.3 A product's page

- **Batches:** each batch in stock with expiry, cost (if allowed), MRP and quantity.
- **Why this stock:** every movement that made the stock what it is (see [Stock movements](#18-stock-movements)).
- **Branch values:** shelf (rack) place, branch stock levels and an optional **branch price**, which needs the
  branch price right and a reason.
- **Price history:** every change of MRP and trade price, with who and when.
- **Edit** and **Deactivate:** a deactivated product cannot be sold or bought; its history stays.

---

## 16. Lists and categories

Edit the lists used on products:

- categories
- dosage forms
- manufacturers
- drug classes
- storage conditions
- unit names

Rename an entry or switch it off. Products keep their values.

---

## 17. Batches and expiry

- **Filters:**
  - in stock, near expiry, expired, in quarantine, below zero, all
  - also by product, category and supplier
- **Totals:** number of batches, value at cost (if allowed) and value at MRP.
- **Expiry summary:** how many batches expire within each warning period (30, 60 and 90 days by default). Click a
  number to list them.

**Batch actions** (from the batch's menu):

- **Correct batch details:** fix the batch number, expiry date or MRP, with a reason. The cost is never changed.
- **Quarantine / Release from quarantine:** block a batch from being sold or sent (for example a recall), with a
  reason, and release it later.
- **Return to supplier:** starts a supplier return for this batch.
- **Write off as expired / Write off as damaged:** makes the stock adjustment for you (expired write-off only for
  expired batches).

**Below zero:** if two computers sold the last units of a batch while apart, both sales are kept and the batch goes
below zero. It appears here and in the bell. Count the shelf and correct it with an adjustment.

---

## 18. Stock movements

Every stock change ever made, newest first:

- goods received, sales, returns, adjustments, write-offs, stock take corrections and transfers
- for each: date, product, batch, quantity, before and after, document, user and reason

Filter by product, batch, movement type or date. Movements are never changed or deleted.

---

## 19. Stock adjustments

Use an adjustment when the stock on the shelf differs from Mediescare.

1. Press **New adjustment** and choose the kind:
   - opening stock, increase, decrease, damaged, lost, or expired write-off (only for expired batches)
2. Add the lines (product, batch, quantity) and write the reason.
3. Save.
   - **Small adjustments** post at once.
   - **Above the branch limit** (Rs 5,000 by default), they wait in **Approvals** for someone with the approve
     right. Nobody approves their own.
   - **Rejected** adjustments change nothing.

---

## 20. Stock take

1. **Start a stock take:** name it and choose what to count (a shelf, a category, a supplier's products, or the
   whole branch).
2. **Count:**
   - Type the counted quantity for each batch.
   - Several people can count, and the counts save as you go.
   - Selling can continue during the count.
3. **Finish and correct stock:** each counted line is corrected by the difference (counted minus what Mediescare had
   when the count started). Uncounted lines are not changed.
4. **Cancel** a stock take that should not be used.

---

## 21. Transfers between branches

How Head Office sends stock to a branch:

1. **Request (optional):** a branch asks for items. If requests need approval (a setting), the sender approves or
   rejects them.
2. **Send:** the sender adds products and quantities, or opens an approved request.
3. **Dispatch:** stock leaves the sender. Batches are chosen by nearest expiry; you can choose others. Expired or
   quarantined batches are never sent. The stock is now **in transit**.
4. **Receive:** the receiving branch opens the transfer, checks what arrived and confirms. If less arrived, type the
   received quantity and a reason.
5. **Settle a shortage:** the sender decides whether the missing stock is **returned to stock** or **written off**.

Stock can also go back from a branch to Head Office the same way.

---

## 22. Reorder list, stock value and movers

- **Reorder list:**
  - Products at or below their reorder level or minimum, with a suggested quantity in whole packs and the default
    supplier.
  - Select lines to start a purchase order.
- **Stock value and movers:**
  - Stock value by branch, category, product or batch (at cost if allowed, and at MRP).
  - **Fast, slow and dead movers** over a period.

---

## 23. Barcode labels

1. Add products (and optionally batches).
2. Choose the label size (38x25, 50x25 or 50x30 mm) and the number of copies.
3. Check the preview, then **Print** (through the Windows print window) or **Save as PDF**.

The barcode is the product barcode, or the SKU when there is none.

---

## 24. Importing data

Bring in products, suppliers, customers (with opening balances) or opening stock from CSV, TXT, Excel (XLSX or XLS),
JSON or XML.

1. Choose what to import. Download a **template** if you want to see the columns.
2. **Choose file.** Mediescare matches your columns to its fields; change any match if needed.
3. Choose what happens if a record already exists: skip it, update it, or treat it as a mistake.
4. **Check all rows.** Every row is checked and problems are listed by row number.
5. **Import.** Nothing is imported while any row has a problem. Fix the file and try again.

---

## 25. Suppliers

- **Add supplier:**
  - name, code, contact person and phone, email, address, city
  - licence number, NTN, STRN
  - payment terms (days), credit limit, opening balance owed, extra contacts
- **A supplier's page:**
  - details
  - **statement** (purchases, returns and payments with a running balance)
  - **unpaid bills with ageing** (0-30, 31-60, 61-90, over 90 days)
  - purchase history
  - **price comparison** (what each product cost from each supplier)

---

## 26. Purchase orders

1. **New purchase order:** choose the supplier and add products, quantities and prices.
2. Save it as a draft, then mark it **ordered**.
3. When goods arrive, press **Receive goods** (see [Goods received](#27-goods-received)). The order shows what has
   come and what is still to come.
4. **Close order** stops waiting for items that will not come. **Cancel** cancels an order nothing was received on.

---

## 27. Goods received

Receiving a supplier's delivery puts stock on the shelf by batch.

1. **Receive goods:** choose the supplier (and the purchase order, if any). Type the supplier's invoice number and
   date, the received date and the payment due date (empty means it is worked out from the supplier's terms).
2. Add a line for each batch:
   - product, batch number, expiry date (and manufacture date)
   - quantity and **bonus** (free) quantity
   - price per pack, discount %, tax %, MRP
3. Add a bill discount and freight if any.
4. **Save** as a draft to finish later, or **Post (add to stock)**.

**When you post:**

- Each line becomes a batch with its **landed cost**: price after discounts, plus its share of freight, spread over
  the paid and bonus units. The parts add up exactly.
- The supplier's account shows the amount owed.
- The latest purchase becomes the product's default MRP and trade price (the history is kept).

**Checks:**

- Expired batches are refused.
- A supplier invoice number cannot be used twice.
- You cannot receive more than is open on the order.

**Cancel** a posted receipt only while its stock is untouched and nothing is paid on it. **Return items to
supplier** starts a return from it.

---

## 28. Returns to suppliers

1. Choose the supplier (or start from a goods receipt or a batch).
2. Choose the reason: expired, near expiry, damaged, wrong item or other.
3. Add the batches and quantities, then save.

Stock leaves and the supplier's account goes down. Cancel a return with a reason if it was a mistake.

---

## 29. Supplier payments

1. **Pay supplier:** choose the supplier, the method (cash, bank, cheque or online), the reference and the amount.
2. Choose which bills it pays, or let Mediescare pay the oldest first.
3. Save.

Cancel a wrong payment with a reason; it is never deleted.

---

## 30. Dashboard

**Today:**

- net sales and number of bills
- cash, card, online (Easypaisa, JazzCash, bank) and credit
- payments received from customers, returns, expenses
- gross profit (if allowed)

**Needs attention:**

- low or out of stock, expiring soon, expired on the shelf
- customers who owe and suppliers you owe (with overdue counts)
- requests waiting for your approval

**Charts:**

- sales trend (30 days)
- top products
- sales by category
- sales and purchases (6 months)

Hover over a chart to see the numbers. **Table** shows the same numbers as a table. **Click any figure or chart** to
open the bills, products or report behind it. People who see all branches can choose the branch at the top.

---

## 31. All branches

For the owner and Head Office:

- every branch side by side for a period (last 7, 30 or 90 days, or this month)
- bills, net sales, average bill, gross profit and margin, expenses
- money owed both ways, stock value
- low stock, near expiry and expired counts
- totals at the bottom and a chart of net sales by branch

Click a branch to open its dashboard. Data from a branch appears after that branch has synced.

---

## 32. Reports

Open **Reports** and choose one. Every report is worked out from the records when you open it, so it always agrees
with the screens.

| Group | Reports |
|---|---|
| Sales | Daily sales, Monthly sales, Sales by product, Sales by category, Sales by cashier, Sales by branch, Sales by payment method, Discounts given, Cashier shifts |
| Money and accounts | Gross profit, Tax report, Expenses by category, Customer balances and ageing, Customer accounts for a period, Supplier accounts for a period, Management summary |
| Purchases | Purchases |
| Stock | Expiry, Stock valuation, Inventory reconciliation and stock movement |

**Filters:**

- **Period:** today, yesterday, last 7 or 30 days, this month, last month, this year, or custom dates.
- **Branch:** this branch, another branch, or all (if allowed).
- Depending on the report: product, category, supplier, customer, cashier or payment method.

**Notes on some reports:**

- Cancelled bills are not counted. Returns count on the day they were made.
- **Inventory reconciliation:** for each product, opening + purchases + customer returns + transfers in +
  adjustments - sales - write-offs - transfers out - supplier returns = expected closing, compared with the stock on
  hand. Highlighted rows have a difference or a stock-take correction.
- **Management summary:** the main numbers of the period next to the previous period of the same length.

Click a row to open what is behind it. **Print** prints on A4. **Export** saves PDF, Excel, CSV, TXT, JSON or XML
with the organisation, branch, filters, time and your name at the top.

---

## 33. Financial journal

Every money event of the branch for a period:

- sales and cancelled bills, customer returns
- payments received and their cancellations
- purchases and their cancellations, supplier returns
- supplier payments, expenses
- cash put in or taken out of the drawer, petty cash moves
- stock write-offs and adjustments (at cost, if allowed)

Columns:

- amount, money in, money out
- change in what customers owe
- change in what you owe suppliers
- change in stock value

**Summary by type** totals each kind. Filter by period, branch, type and method, or search by document, name or
note. Click a row to open the document. Print or export it.

---

## 34. Expenses

Rent, salaries, electricity, tea and every other cost.

1. **Add expense:** date, category, description, paid to, amount, **paid from**, and reference (needed for bank and
   online).

   | Paid from | What happens |
   |---|---|
   | Drawer (this computer) | The cash leaves the open shift of this computer, so the shift report stays right. |
   | Petty cash box | It comes out of the petty cash balance. |
   | Bank, card, online | Recorded with its reference. |

2. Save.

**Approval:** expenses above the branch limit (Rs 10,000 by default) wait in **Approvals**; the money moves only
when approved. A big expense from the drawer needs a manager straight away (at the counter or from another
computer).

**Cancel expense:** with a reason. The money goes back where it came from. Nothing is deleted.

**Categories:** rename, add or switch off categories.

---

## 35. Petty cash

The petty cash book shows money put into the box and what was spent from it, with a running balance, for any
period.

- **Put money in:** the amount and a reason. Tick **Take this money from the drawer of this computer** when it comes
  from the cash drawer.
- **Take money out:** the reverse.
- Expenses paid from the petty cash box appear here by themselves.

---

## 36. Approvals

Everything in the branch that waits for a manager:

- counter requests (big discount, changed price, credit, cancel a bill, large return, big expense)
- expenses above the limit
- stock adjustments and expired write-offs above the limit
- transfer requests

How to use it:

- **Waiting:** press **Approve** or **Reject**. A rejection needs a reason. **Open** shows the document.
- **Decided:** the history, with who decided, when and why.
- New requests appear by themselves.
- You see only what your rights allow you to decide. Nobody can approve their own request.

---

## 37. Notifications (the bell)

The bell lists, for your branch and your rights:

- out of stock, low stock, expired stock on the shelf, expiring soon, stock below zero
- customer bills overdue (after 30 days by default), supplier bills past their due date
- requests waiting for your approval
- transfers on the way, transfers to send, transfer shortages to settle
- sync failing, sync conflicts, a wrong computer clock
- backup failed, no recent backup

Click one to open the page that deals with it. Opening the list marks them as seen. A notification disappears by
itself when the cause is fixed.

---

## 38. Global search

Press **Ctrl+K** (or click the search box) and type. You can find:

- pages, actions and reports
- medicines (by name, salt, SKU or barcode), batches
- bills, customers (name, phone, code, CNIC), suppliers
- purchase orders, goods receipts, transfers, payments, expenses, adjustments
- users and branches

Use the arrows and **Enter** to open a result. **Scan a barcode or type a full document number and press Enter** to
open it straight away. You only see what your role and branch allow.

---

## 39. Keyboard shortcuts

Open **Keyboard shortcuts** from your name at the top right, or press **Ctrl+/**.

| Key | Action |
|---|---|
| Ctrl+K | Search everything |
| Alt+N | Open notifications |
| Ctrl+/ | Show keyboard shortcuts |
| Ctrl+Shift+L | Sign out |
| Alt+H | Home |
| Alt+D | Dashboard |
| Alt+P | Point of sale |
| Alt+S | Sales history |
| Alt+M | Medicines |
| Alt+C | Customers |
| Alt+R | Reports |
| Alt+E | Expenses |
| Alt+A | Approvals |
| Alt+J | Financial journal |

The counter keys are listed in [Point of sale](#10-point-of-sale-the-counter).

**To change a key:**

1. Click it and press the new combination (Escape keeps the old one).
2. A key used twice is highlighted and must be changed before saving.
3. Plain letters need Ctrl or Alt.
4. Press **Save changes**. **Use default** resets one key; **Reset all to default** resets everything.

Your keys follow your account on every computer. Managers with the right can edit other people's keys.

---

## 40. Branches

- **Add branch:**
  - name, code (2 to 6 letters, for example LHR), address, phone, licence number
  - the branch manager's account (a temporary password is shown once)
- **Edit** details; **Deactivate** a closed branch (the Head Office cannot be deactivated).
- **Switch branch:** people allowed to switch choose the branch from the top bar.

To set up the branch's main computer, make a join code on **Computers**.

---

## 41. Users

- **Add user:** full name, username, role, branch, phone, email. A temporary password is shown once; the user must
  change it at their first sign-in.
- **Edit** the role or branch.
- **Disable / Enable:** a disabled user is signed out at once and cannot sign in. Users are never deleted, so the
  records keep their names.
- **Reset password:** gives a new temporary password.
- **Unlock:** after too many wrong passwords.

You can only give roles with rights you have yourself.

---

## 42. Roles and permissions

- A role is a checklist by module, with the actions:
  - View, Create, Edit, Delete or deactivate, Approve, Export and print
- Special rights:
  - see purchase cost and profit
  - give discounts above the limit, change prices at the counter
  - sell on credit, cancel bills, take returns, reprint receipts
  - change payment dates
  - dispatch and receive transfers
  - branch buys directly from suppliers, set branch prices
  - switch branch, see all branches
  - see financial reports
  - run sync manually, restore backups
  - edit other people's shortcuts
- **Add role**, edit or deactivate roles. A role in use cannot be deactivated. The Super Admin role cannot be
  changed.

---

## 43. Computers, join codes and the recovery key

- **Computers:** every registered computer with its branch and number (for example LHR2), main or extra, and status.
  - **Rename:** change a computer's name.
  - **Block:** a lost or stolen computer can no longer sync (a reason is required).
- **Join codes:** made here for a branch's new main computer (see [Joining](#5-joining-a-branch-computer)).
  - The list shows each code's branch, last four letters, status (ready, used, expired, cancelled), who made it and
    until when.
  - **Cancel** a code that should not be used.
- **Organisation recovery key:** the way back if the Head Office computer is lost. Only the owner can **Make a new
  recovery key**; the old one stops working. Write the new key down; it is shown only once.

---

## 44. Settings

Organisation values, with branch values where allowed. Every change is recorded.

| Setting | Default |
|---|---|
| Currency symbol, decimals, date format | Rs, 2, DD/MM/YYYY |
| Tax name on receipts | Sales tax |
| Near-expiry warning periods (days) | 30, 60, 90 |
| A cashier must open a shift before selling | On |
| Highest discount (%) without a manager | 10 |
| Returns that need a manager (Rs, 0 = never) | 5,000 |
| Customer bills overdue after (days) | 30 |
| Minutes an approved counter request stays usable | 30 |
| Receipt paper, show batch and expiry, print automatically, footer | 80 mm, on, on |
| Stock adjustments that need approval (Rs) | 5,000 |
| Expenses that need approval (Rs, 0 = never) | 10,000 |
| Transfer requests need approval | On |
| Minimum password length, wrong tries before lock, lock minutes | 6, 5, 15 |
| Sign out after idle minutes (0 = never) | 30 |

---

## 45. Sync

Shows the two connections separately:

- **Shop network:** between the computers of the branch.
- **Cloud:** between the branch's main computer and Head Office and the other branches.

For each: state, last success, changes waiting, and **Sync now** (needs the right).

- **Add a computer** (main computer only): shows the 6-digit pairing code.
- **Sync log:** every exchange with counts and errors.
- **Conflicts:** things changed on two computers while apart and settled automatically (for example two users made
  with the same username: one is renamed). Read them and mark them done.
- **Clock warning:** this computer's clock differs from the main computer's. Fix the Windows date and time.

---

## 46. Backups

- **Automatic backups:**
  - Every day each computer makes a compressed backup; the last 14 are kept.
  - A safety copy is made before every restore and update.
  - The backups run in the background, so the counter keeps working.
- **Make a backup now:** makes one immediately.
- **Second copy:** choose a USB disk or another folder; every backup is also copied there.
- **Encryption:** turn it on to lock backups to this computer and Windows user.
- **Restore** (needs the right):
  1. Choose a backup from the list, or **Restore from a file** (for example from a USB disk).
  2. A safety copy of today is made first, then the app restarts with the restored data.
  3. Only backups of your own organisation can be restored.

---

## 47. Receipt printer

Settings for this computer only:

- **Receipt printer:** choose the printer, the Windows default, or "Ask every time (print window)". If no printers
  are listed, install the printer in Windows first.
- **Paper on this computer:** the same as the branch setting, or 58 mm, 80 mm or A4 for this computer.
- **Print receipts without showing the print window** (faster; needs the printer chosen above).
- **Show the bill on a customer display:** opens a second window, on the second screen when one is connected.

To check the printer, make a small test sale (or reprint a receipt from Sales and receipts).

**Cash drawer:** turn on "open drawer on print" in the printer's own Windows settings (driver); the drawer then
opens with each receipt.

---

## 48. Audit log

Every important action:

- what, who, when, at which branch and computer
- the old and new values, and the reason

Filter by user, module, action, record and date. Open a row to see exactly what changed. The log cannot be changed
or deleted. Export it if needed.

---

## 49. My profile

- Change your name, username, phone and email.
- **Change password.**
- **Appearance:** light, dark, or the same as Windows. **Table spacing:** comfortable or compact.

---

## 50. Help and updates

- **Version** of Mediescare on this computer and the **update** state.
- When a new version is downloading or ready, **Update** also appears in the top bar. Click it to see the version;
  managers can press **Restart and update** there.
- When an update has downloaded, a manager presses **Restart and update**. A safety backup is made, then Mediescare
  restarts with the new version. Updates also install when the app is closed. Your data stays as it is.
- **Guides:** the cashier quick-start and the administrator guide.

---

## 51. Exporting and printing lists

Most lists and every report have **Print** (A4 through the Windows print window) and **Export**:

- PDF, Excel (XLSX or XLS), CSV, TXT, JSON or XML
- with the organisation, report, branch, filters, time and your name at the top
- exports follow your rights: hidden costs stay hidden

---

## 52. Working without internet

- **Every computer works on its own.** Sell, receive, adjust and report with no internet and no network.
- When the shop network returns, extra computers share their changes with the main computer. When the internet
  returns, the main computer shares with the cloud, so Head Office and the other branches see them.
- If the main computer is off, the other computers keep working and catch up when it is back.
- Bill numbers include the branch and the computer number (for example INV-LHR2-0001), so two computers never make
  the same number.
- If two computers sold the last units of a batch while apart, the batch shows **below zero** (see
  [Batches](#17-batches-and-expiry)).

---

## 53. Problems and answers

| Problem | What to do |
|---|---|
| "You do not have permission" | Your role does not allow it. Ask your manager. |
| Account locked | Wait 15 minutes, or ask a manager to unlock it in Users. |
| Signed out by itself | The screen was idle. Sign in again; nothing is lost. |
| Sync says Offline | Check the network cable, Wi-Fi or internet. Keep working; it catches up. |
| A number in brackets next to Sync | Changes are waiting to be sent. They go when the connection works. |
| Join code refused | Check the organisation code and the join code. Codes work once and for 24 hours; ask Head Office for a new one. |
| "Too many wrong codes" | Wait an hour, or ask Head Office for a new code. |
| Pairing code refused | It lasts 10 minutes and works once. Press Add a computer again on the main computer. |
| Stock below zero | Count the shelf and make an adjustment. |
| Shift cash does not match | Write a note when closing. The manager sees it in Cashier shifts. |
| Receipt not printing | Check the printer on the Receipt printer page and in Windows, then reprint the bill from Sales and receipts. |
| No recent backup | Open Backups and press Make a backup now. Check the disk has space. |
| Clock warning | Correct the Windows date and time. |
| Something else | Note the message, then send `%APPDATA%\Mediescare\logs\main.log` to support. Do not delete any files in the data folder. |
