# Final testing checklist (several computers)

Use this list for the final test before opening the pharmacy. Tick each line. Write down anything that fails, with
the exact message on screen, the time, the computer and the user, and send `%APPDATA%\Mediescare\logs\main.log` from
that computer.

**Suggested setup:**
- **PC-A:** Head Office main computer
- **PC-B:** a branch's main computer (for example Soldier Bazar)
- **PC-C:** an extra counter computer in that branch, on the same Wi-Fi as PC-B
- Use test products and amounts. Before going live, start with clean data (see the end of this list).

## 1. Install and first start

- [ ] Download the installer from Releases on each PC and install. PC-A and PC-B use "all users".
- [ ] PC-A: the Head Office data is there (or create the Head Office and write down the recovery key).
- [ ] PC-A: Computers > New join code for the branch. PC-B joins with the organisation code + join code + the branch
      manager's login, and is signed in.
- [ ] PC-B: Sync > Add a computer. PC-C joins as an extra computer with the pairing code (try "Find the main computer
      on this network", and also typing the address).
- [ ] A wrong join code, an expired one and a used one are refused with a plain message.
- [ ] Top bar on every PC: the right branch, the user and role, Sync "Up to date", a backup time.

## 2. Users and permissions

- [ ] PC-B: make one user of each role (Pharmacist, Cashier, Store Keeper, Accountant).
- [ ] Each one signs in on PC-C, must change the temporary password, and sees only their menus.
- [ ] A cashier cannot see cost or profit anywhere (product, batches, sales, reports, exports).
- [ ] 5 wrong passwords lock the account; a manager unlocks it.
- [ ] Disable a user: they are signed out at once on every PC after sync.

## 3. Stock in

- [ ] PC-A: add products (with barcode, pack size, MRP), a supplier, and a goods receipt with two batches (different
      expiry dates), a bonus quantity, a discount and freight. Post it.
- [ ] PC-A: transfer stock to the branch. PC-B: receive it, once with a shortage (reason), and settle the shortage on
      PC-A.
- [ ] PC-B: the stock and batches arrived; the near-expiry batch is first (FEFO).
- [ ] Import products or opening stock from an Excel or CSV file (Import data).

## 4. Counter (PC-B and PC-C)

- [ ] Open a shift with the counted cash.
- [ ] Scan a barcode; search by brand, by salt and by part of a name; the out-of-stock substitutes appear.
- [ ] Sell by tablet, strip and box. Change the quantity (F4). The near-expiry batch is marked.
- [ ] Line discount and bill discount (F6). A discount above the limit asks for a manager: approve at the counter, and
      once with "Ask a manager on another computer" (approve it on PC-B's Approvals page).
- [ ] Payments: cash with change, card, Easypaisa/JazzCash with a transaction number, mixed, and credit to a
      customer with a limit.
- [ ] Prescription-only item: patient and doctor required. Controlled item: CNIC, PMDC number and prescription number
      required; it appears in the controlled drug register.
- [ ] Hold a bill (F8) and resume it (F9).
- [ ] The receipt prints on the real printer (58 or 80 mm). Reprint is marked COPY. The cash drawer opens (printer
      driver setting). Medicine labels print.
- [ ] Customer display on a second screen (if available).
- [ ] Return part of a bill (restock, damaged, quarantine) and cancel a whole bill (as a cashier, with approval).
- [ ] Close the shift with a wrong count: a note is required; the X and Z reports print.

## 5. Offline and sync

- [ ] Unplug PC-B's internet: PC-B and PC-C keep selling. Sync shows Offline; the number of waiting changes grows.
- [ ] Turn PC-B (the main computer) off: PC-C keeps selling. Turn it on: PC-C catches up within seconds.
- [ ] Reconnect the internet: within a minute PC-A sees the branch's bills, stock and money (Dashboard > All branches,
      Reports with the branch chosen).
- [ ] Bill numbers from PC-B and PC-C never clash (for example INV-SB1-0003 and INV-SB2-0003).
- [ ] Sell the last strip of a batch on PC-B and PC-C while the network is off. After sync, the batch shows "Below
      zero" and a notification. Correct it with an adjustment.
- [ ] Change a product price on PC-A: it reaches PC-B and PC-C.

## 6. Money and reports

- [ ] Expenses from the drawer, from petty cash and from the bank. One above the limit goes to Approvals.
- [ ] Customer pays later (Receive payment): it goes to the oldest bills.
- [ ] Supplier payment against the goods receipt; the supplier ageing is correct.
- [ ] Dashboard: today's figures match the bills; clicking a figure opens the bills.
- [ ] Reports: Daily sales, Sales by product, Gross profit, Tax, Expiry, Stock valuation, Inventory reconciliation (no
      unexplained differences), Management summary. Print one and export PDF and Excel.
- [ ] Financial journal for the day matches the sales, returns, receipts and expenses.

## 7. Stock control

- [ ] Stock adjustment above the limit waits for approval; nobody approves their own.
- [ ] Stock take on one shelf: the corrections post; uncounted lines do not change.
- [ ] Quarantine a batch: it cannot be sold or sent. Release it.
- [ ] Expiry report and the bell show near-expiry and expired batches.

## 8. Backups, updates and recovery

- [ ] Backups: Make a backup now; set a USB folder; restore a backup (the app restarts with that data).
- [ ] Update: after a new version is released, the top bar shows "Update" within an hour (or press Check now on Help
      and updates). Restart and update: the app restarts on the new version and all data is still there.
- [ ] Block a computer (Computers > Block): it can no longer sync.
- [ ] (Optional) Recovery: on a spare PC, join as Head Office with the organisation code and the recovery key; the
      data comes back.

## Before going live

- [ ] Decide whether the test data is kept or the pharmacy starts clean. Starting clean means a new organisation on
      a clean cloud database; ask the developer to prepare it, because the cloud keeps all history.
- [ ] Write the recovery key on paper and keep it safe.
- [ ] Every user has their own account and has changed their password.
