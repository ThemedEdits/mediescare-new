'use strict';
// Every user-facing message produced by the main process. Keep the wording plain enough for a cashier.
// Placeholders use {name}. Urdu can be added later as another table with the same keys.

const en = {
  // Generic
  'error.unexpected': 'Something went wrong and nothing was saved. Please try again. If it keeps happening, tell your manager.',
  'error.notSignedIn': 'You are signed out. Please sign in again.',
  'error.sessionExpired': 'You were signed out because the screen was not used for a while. Please sign in again.',
  'error.noPermission': 'You do not have permission to do this. Ask your manager if you need it.',
  'error.unknownAction': 'This action is not available.',
  'error.notFound': 'This {thing} could not be found. It may have been removed.',
  'error.required': 'Please fill in {field}.',
  'error.tooLong': '{field} is too long. Use at most {max} characters.',
  'error.invalid': '{field} is not valid.',
  'error.duplicate': 'A {thing} with this {field} already exists.',
  'error.readOnly': 'This record cannot be changed.',
  'error.inUse': 'This {thing} is in use and cannot be removed. You can deactivate it instead.',
  'error.branchInactive': 'This branch is deactivated.',
  'error.wrongBranch': 'This record belongs to another branch.',

  // Setup
  'setup.alreadyDone': 'This computer is already set up.',
  'setup.joinNeedsSync': 'Joining an existing Head Office or branch needs the sync service, which is not set up on this computer yet. Ask your administrator to finish the sync setup, then try again.',
  'setup.codeFormat': 'The code can use only letters and numbers (2 to 6 characters), for example LHR.',
  'setup.orgCodeFormat': 'The organisation code can use only letters and numbers (3 to 12 characters).',
  'setup.setupKeyRequired': 'Please enter the cloud setup key to register this Head Office with the cloud.',
  'setup.setupKeyInvalid': 'Invalid cloud setup key. This key is required to register a Head Office on the cloud gateway.',
  'setup.orgAlreadyExistsInCloud': 'Organisation code "{code}" is already registered in the cloud with an existing Head Office. You cannot create multiple Head Offices for the same organisation. To connect this computer, go back and choose "Connect a branch computer to Head Office".',
  'setup.cloudRegistrationFailed': 'Could not register Head Office with cloud gateway: {reason}. A working connection to the cloud gateway is required to create a Head Office.',

  // Auth
  'auth.badLogin': 'The username or password is not correct.',
  'auth.locked': 'This account is locked for {minutes} more minute(s) after too many wrong passwords. Try again later or ask your manager to unlock it.',
  'auth.disabled': 'This account is disabled. Ask your manager.',
  'auth.branchMissing': 'Your account is not linked to a branch on this computer. Ask your manager.',
  'auth.wrongCurrent': 'Your current password is not correct.',
  'auth.passwordShort': 'The password must be at least {min} characters long.',
  'auth.passwordSame': 'The new password must be different from the current one.',
  'auth.passwordMismatch': 'The two passwords do not match.',
  'auth.usernameFormat': 'The username can use letters, numbers, dot, dash and underscore only (3 to 32 characters).',
  'auth.mustChange': 'Please choose a new password before you continue.',

  // Users / roles / branches
  'users.cannotDisableSelf': 'You cannot disable your own account.',
  'users.cannotChangeOwner': 'Only the owner can change the Super Admin account.',
  'users.onlyOneSuper': 'There can be only one Super Admin. Give this user the Admin role instead.',
  'users.cannotChangeOwnRole': 'You cannot change your own role.',
  'roles.systemLocked': 'The Super Admin role cannot be changed.',
  'roles.nameTaken': 'A role with this name already exists.',
  'roles.inUse': 'This role is given to {count} user(s). Move them to another role first.',
  'branches.codeTaken': 'Another branch already uses this code.',
  'branches.headOfficeLocked': 'The Head Office cannot be deactivated.',
  'branches.switchNotAllowed': 'You can only work in your own branch.',
  'audit.reasonRequired': 'Please write a reason for this change.',

  // Validation (Phase 1)
  'error.wholeNumber': '{field} must be a whole number.',
  'error.range': '{field} must be between {min} and {max}.',
  'error.money': '{field} must be an amount, for example 125.50.',
  'error.notNegative': '{field} cannot be less than zero.',
  'error.percent': '{field} must be a percentage between 0 and {max}.',
  'error.date': '{field} is not a valid date.',
  'error.noLines': 'Add at least one item.',
  'error.wrongStatus': 'This {thing} is {status} and cannot be changed now.',
  'error.costHidden': 'You cannot see purchase costs, so you cannot do this. Ask your manager.',

  // Lookups
  'lookups.nameTaken': 'This name is already in the list.',

  // Products
  'products.skuTaken': 'Another product already uses this SKU.',
  'products.barcodeTaken': 'Barcode {barcode} already belongs to {product}.',
  'products.barcodeTwice': 'Barcode {barcode} is entered twice.',
  'products.packLocked': 'The pack size cannot be changed because this product already has stock movements. Create a new product instead.',
  'products.controlledNeedsRx': 'A controlled drug must also be prescription-only.',
  'products.maxBelowMin': 'Maximum stock cannot be less than minimum stock.',
  'products.unitDuplicate': 'Two selling units have the same name: {name}.',
  'products.inactive': '{product} is deactivated.',
  'products.onlyHeadOffice': 'Only Head Office can add new medicines and products to the catalog.',

  // Stock
  'stock.notEnough': 'Only {available} are available in batch {batch} of {product}. You entered {wanted}.',
  'stock.notEnoughProduct': 'Only {available} of {product} are available. You need {wanted}.',
  'stock.expiredBatch': 'Batch {batch} of {product} expired on {date}. Expired stock cannot be used here.',
  'stock.quarantined': 'Batch {batch} of {product} is in quarantine and cannot be used.',
  'stock.batchWrongProduct': 'This batch belongs to a different product.',
  'stock.expiryBeforeMfg': 'The expiry date must be after the manufacture date.',
  'stock.expiryPast': 'The expiry date {date} has already passed. Expired stock cannot be received.',
  'stock.selfApprove': 'You cannot approve or reject your own request.',
  'stock.takeOpen': 'A stock take ({doc}) is already in progress for this branch. Finish or cancel it first.',
  'stock.takeNothing': 'There is no stock to count with these filters.',
  'stock.notExpired': 'Batch {batch} has not expired yet. Use a damaged or decrease adjustment instead.',

  // Purchasing
  'purchases.directNotAllowed': 'This branch is not allowed to buy directly from suppliers. Ask the Head Office to send stock.',
  'purchases.poNotOpen': 'This purchase order is {status} and cannot receive goods.',
  'purchases.overReceive': 'You are receiving more of {product} than is still open on the order ({open}).',
  'purchases.invoiceDuplicate': 'Supplier invoice {invoice} from this supplier was already received in {doc}.',
  'purchases.cannotCancelGrn': 'This goods receipt cannot be cancelled because some of its stock has already been sold, moved or returned. Return the remaining stock to the supplier instead.',
  'purchases.paidGrn': 'This goods receipt has payments allocated to it. Cancel those payments first.',
  'purchases.allocationTooMuch': 'The amounts allocated to bills ({allocated}) are more than the payment ({amount}).',
  'purchases.allocationOverBill': 'Bill {doc} only has {due} left to pay.',
  'purchases.supplierInactive': 'This supplier is deactivated.',
  'purchases.wrongSupplierBatch': 'Batch {batch} was not bought from this supplier.',

  // Transfers
  'transfers.sameBranch': 'Choose a different branch to send to.',
  'transfers.wrongSide': 'Only the {side} branch can do this. Switch to that branch first.',
  'transfers.receiveMore': 'You cannot receive more than was sent.',
  'transfers.discrepancyReason': 'Please write why the received quantity is different for {product}.',
  'transfers.approvalRequired': 'This transfer needs approval before it can be dispatched.',
  'transfers.nothingToResolve': 'There is no open difference on this transfer.',
  'transfers.dispatchTooMuch': 'You are sending more of {product} than was requested.',

  // Import
  'import.unsupported': 'This file type is not supported. Use CSV, Excel (XLSX or XLS), JSON, XML or TXT.',
  'import.empty': 'The file has no rows to import.',
  'import.tooMany': 'The file has {n} rows. Import at most {max} rows at a time.',
  'import.expired': 'The import session has expired. Please choose the file again.',
  'import.hasErrors': 'Fix the {n} row(s) with errors first. Nothing was imported.',
  'import.unreadable': 'The file could not be read. Check that it is not open in another program and that it is a real {type} file.',
  'import.mappingMissing': 'Choose a column for {field}.',

  // Point of sale
  'pos.noShift': 'Open your shift before selling.',
  'pos.shiftOther': 'A shift by {user} is open on this computer. It must be closed before you can open yours.',
  'pos.shiftOpen': 'You already have an open shift on this computer.',
  'pos.shiftNotYours': 'This shift belongs to {user}. Only they or a manager can close it.',
  'pos.emptyBill': 'The bill is empty. Add at least one item.',
  'pos.unitWrong': 'This selling unit does not belong to {product}.',
  'pos.notSellable': '{product} cannot be sold by the {unit}.',
  'pos.discountTooHigh': 'A discount of {percent}% is more than you may give ({max}%). Ask a manager to approve it.',
  'pos.priceNeedsApproval': 'Changing the price needs a manager.',
  'pos.creditNeedsCustomer': 'The bill is not fully paid. Choose a customer to sell on credit, or take the full amount.',
  'pos.creditNotAllowed': 'You may not sell on credit. Ask a manager.',
  'pos.creditLimit': '{customer} would owe {owed}, more than their credit limit of {limit}.',
  'pos.noCreditLimit': '{customer} has no credit limit. Set one on the customer before selling on credit.',
  'pos.overpaidCard': 'Card and online payments cannot be more than the bill. Only cash can give change.',
  'pos.referenceNeeded': 'Enter the transaction or slip number for the {method} payment.',
  'pos.rxNeeded': '{product} needs a prescription. Enter the patient and doctor details.',
  'pos.controlledNeeded': '{product} is a controlled drug. Enter the patient CNIC, the doctor PMDC number and the prescription number.',
  'pos.approvalInvalid': 'The manager approval has expired. Ask the manager to approve again.',
  'pos.approverNoRight': '{user} is not allowed to approve this.',
  'pos.approverSelf': 'You cannot approve your own request. Ask another manager.',
  'pos.voidHasReturns': 'This bill has returns or later payments, so it cannot be cancelled. Use a return instead.',
  'pos.returnTooMuch': 'Only {qty} of {product} can still be returned on this bill.',
  'pos.returnNeedsApproval': 'A return worth {amount} needs a manager to approve it.',
  'pos.refundAccountNoCustomer': 'This bill has no customer, so the refund cannot go to an account.',
  'pos.receiptTooMuch': 'The customer owes {owed}. You entered {amount}.',
  'pos.holdNotFound': 'This held bill is no longer here. It may have been resumed already.',
  'pos.walkInNoCredit': 'Walk-in customers cannot buy on credit.',
  'pos.voidedBill': 'This bill was cancelled.',
  'pos.shiftClosed': 'This shift is already closed.',
  'setup.joinIncomplete': 'The data of your branch did not arrive completely. Check the connection and try again.',
  'sync.lanOff': 'The shop network service is not running on this computer. Only the main computer of the branch can pair new computers.',
  'sync.cloudNotBuilt': 'This copy of Mediescare has no cloud address yet.',
  'sync.onlyHeadOffice': 'Only the main computer of the Head Office connects the organisation to the cloud.',
  'sync.cloudFailed': 'The cloud could not be reached: {reason}',
  'backup.failed': 'The backup could not be written. Check that the disk is not full.',
  'backup.missing': 'This backup file is no longer there.',
  'backup.keyMissing': 'This backup is locked to another computer or Windows account and cannot be opened here.',
  'backup.notOurs': 'This file is not a Mediescare backup of this organisation.',
  'backup.noEncryption': 'Encryption is not available on this computer.',
  'pos.voidNeedsApproval': 'Cancelling bill {doc} needs a manager to approve it.',
  'expenses.needShift': 'Open a shift on this computer first. Cash for this comes from (or goes back to) the drawer of this computer.',
  'expenses.pettyShort': 'The petty cash box has only {balance}. You entered {amount}.',
  'expenses.future': 'An expense cannot be dated in the future.',
  'expenses.needsReference': 'Please write the bank or transaction reference.',
  'expenses.needsApproval': 'An expense of {amount} paid from the drawer needs a manager to approve it now.',
  'approvals.notOwn': 'You cannot approve your own request. Ask another manager.',
  'approvals.noRight': 'You do not have the right to approve this request.',
  'approvals.alreadyDecided': 'Someone has already decided this request.',
  'reports.badRange': 'The end date must be on or after the start date.',
  'shortcuts.badKey': '{key} cannot be used for {action}. Use a function key (F1 to F12), or a letter or number together with Ctrl or Alt.',
  'shortcuts.conflict': '{key} is used for both {first} and {second}. Give one of them another key.',
  'setup.joinCodeFormat': 'The join code has 12 letters and numbers, for example K7QM-4XPA-9RTD. Ask Head Office for it.',
  'setup.recoveryFormat': 'The recovery key has 20 letters and numbers in groups of four. It was shown when the organisation was created.',
  'setup.joinedSignIn': 'This computer has joined and the data is here, but the username or password was not right (or that person may not add computers). Sign in on the next screen.',
  'device.silentNeedsPrinter': 'Choose the receipt printer before turning on printing without the print window.',
};

function t(key, params) {
  let text = en[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) text = text.split(`{${k}}`).join(String(v));
  }
  return text;
}

module.exports = { t, en };
