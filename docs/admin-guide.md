# Mediescare administrator guide

For the owner, Head Office staff and branch managers. It covers installing, setting up branches and people, and
the daily checks that keep stock, money and data safe.

## 1. Install

1. Run `Mediescare-Setup-<version>.exe` on each computer.
2. Choose **Anyone who uses this computer (all users)** on the main computer of each branch. That lets the installer
   open the Windows Firewall for the shop network (TCP 47800, UDP 47801). On other computers either choice is fine.
3. The data is kept in `%APPDATA%\Mediescare` for the Windows user who runs the app. Uninstalling the app does not
   delete it.

## 2. First start

**The first computer of the organisation (Head Office):**

1. Choose **Create a new Head Office**.
2. Enter the organisation name and a short organisation code (keep it: branches need it to join), the Head Office
   name and code, and your own owner account. The owner is the Super Admin and can do everything.
3. The **organisation recovery key** is shown once. Write it on paper and keep it safe. If the Head Office computer
   is lost, a new computer joins as Head Office with the organisation code and this key. Only the owner can make a
   new key (Computers page); the old one then stops working.

**A new branch:**

1. At Head Office, open **Branches** and add the branch with its code (for example LHR) and its manager. Give the
   manager the temporary password shown once.
2. Still at Head Office, open **Computers**, press **New join code** and choose the branch. Give the person at the
   branch the organisation code and the join code (by phone is fine). The code works once, for 24 hours; it can be
   cancelled on the same page. Head Office must be online so the code reaches the cloud.
3. On the branch's main computer choose **Sign in to an existing Head Office or branch**, then **The main computer of
   the branch**, and type the organisation code, the join code and the manager's login. This needs the internet
   once, so the branch data can arrive from the cloud. The cloud checks only the code; the manager's login is checked
   on the new computer.

**More computers in the same branch:**

1. On the branch's main computer, open **Sync** and press **Add a computer**. A 6-digit code appears for 10 minutes.
2. On the new computer, choose **Sign in to an existing Head Office or branch**, then **An extra computer in the
   branch**, and pick the main computer from the shop network list (or type its address).
3. Enter the code and a manager's login.

Each computer gets its own number, so bill numbers never clash, for example INV-LHR1-0001 and INV-LHR2-0001.

## 3. People and permissions

- **Roles and permissions:** each role is a checklist grouped by module (view, create, edit, delete or deactivate,
  approve, export), plus special rights:
  - see cost and profit
  - give discounts above the limit
  - change prices at the counter
  - sell on credit
  - cancel bills
  - take returns
  - see all branches
  - see financial reports
  - restore backups
  - edit other people's shortcuts

  Six roles come ready made: Super Admin, Branch Admin, Pharmacist, Cashier, Store Keeper and Accountant. Change them
  to fit your shop.
- **Users:**
  - Add a user, choose the role and the branch, and give them the temporary password. They must change it at their
    first sign-in.
  - Disable a user who leaves. Never share accounts: every action is recorded with the person's name.
- **Locked out:** after 5 wrong passwords an account locks for 15 minutes. A manager can unlock it (Users) or reset
  the password.
- **Computers:** a lost or stolen computer can be blocked on the **Computers** page. It can no longer sync.

## 4. Settings that matter

| Setting | Default | What it does |
|---|---|---|
| Highest discount without a manager | 10% | Above it, a manager must approve at the counter |
| Returns that need a manager | Rs 5,000 | Bigger returns need approval |
| Stock adjustments that need approval | Rs 5,000 | Bigger adjustments wait in Approvals |
| Expenses that need approval | Rs 10,000 | Bigger expenses wait in Approvals |
| Customer bills overdue after | 30 days | Feeds the notifications and the ageing report |
| A cashier must open a shift | On | Selling needs an open shift |
| Sign out after idle minutes | 30 | Protects an unattended counter |

Branch values override the organisation values where the setting allows it.

## 5. Approvals

**Approvals** lists everything waiting for a manager:
- counter requests (big discount, typed price, credit, cancelling a bill, large returns)
- expenses above the limit
- stock adjustments and expired write-offs
- transfer requests

A cashier can ask from the counter with **Ask a manager on another computer**. The request appears in Approvals, and
the cashier's screen continues by itself once it is approved. Nobody can approve their own request. Every decision
records who decided, when and why.

## 6. Daily checks (5 minutes)

1. **Dashboard:** today's sales by cash, card, online and credit, plus returns, expenses and what needs attention.
   Click any figure to see the bills behind it.
2. **Bell (top bar):**
   - low or out of stock
   - expiring or expired batches
   - overdue customer and supplier bills
   - approvals and transfers waiting
   - sync and backup problems
3. **Shifts:** every closed shift with a difference between expected and counted cash needs a note. Read the notes.
4. **Sync** (top bar): it should say *Up to date*. A small number in brackets is work waiting to be sent. It goes by
   itself when the network returns.
5. **Backup** (top bar): there should be a backup from today.

## 7. Month end

- **Reports:**
  - Management summary (compared with the month before)
  - Gross profit
  - Tax
  - Expenses by category
  - Customer balances and ageing
  - Supplier accounts
  - Inventory reconciliation: opening + purchases + returns + adjustments - sales - write-offs = closing, per product.
    Highlighted rows have a difference or a stock-take correction.
- **Stock take:** count a shelf or the whole shop. Only counted lines change, and every correction is recorded.
- Every report prints on A4 and exports to PDF, Excel (XLSX or XLS), CSV, TXT, JSON or XML with the organisation,
  branch, filters, time and user at the top.

## 8. Backups and restore

- **Automatic backups:**
  - A backup is made every day on each computer, and the last 14 are kept in `%APPDATA%\Mediescare\backups`.
  - A safety copy is taken before every update, every restore and every database change.
- **Second copy:** on **Backups**, choose a USB disk or another folder for a second copy.
- **Encryption:** you can turn it on. An encrypted backup opens only on the same computer and Windows user.
- **Restore:** on **Backups**, choose a backup and restore it. The app takes a safety copy first, then restarts.
  Restoring needs the "Restore a backup" right.
- **A lost computer:** install Mediescare on a new computer and join the branch again (a branch main computer needs a
  new join code; the Head Office computer needs the recovery key). Its data comes back from the
  cloud (if cloud sync is set up) and from the main computer.

## 9. Updates

When an update is published, every computer downloads it in the background. Open **Help and updates** and press
**Restart and update** (or just close the app at the end of the day). A safety backup is taken first, and the data
stays as it is.

## 10. Moving from another program (once)

`npm run migrate -- <folder>` builds a ready Mediescare database from CSV or JSON files (products, suppliers,
customers, opening stock with batches, opening customer and supplier balances). See `docs/legacy-migration.md` for
the file layout. Run it before the shop starts using Mediescare.

## 11. If something goes wrong

- Messages in the app say what to do in plain words.
- Technical details are written to `%APPDATA%\Mediescare\logs\main.log`. Send that file to support. Do not delete
  anything in the data folder.
- Sales are never lost when the network or the main computer is off. Every computer keeps working on its own and
  catches up later.
- If two computers sell the last unit of a batch while apart, both bills are kept. The batch shows **below zero**
  under Batches and in the bell. Correct it with a stock adjustment.
