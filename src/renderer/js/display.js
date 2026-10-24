// Customer display: shows the bill as the cashier builds it. Receives data only; it cannot call the main process.
const fmt = (minor) => `Rs ${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const $ = (id) => document.getElementById(id);

window.mediescare.onDisplay((d) => {
  $('org').textContent = d.org || '';
  const table = $('lines');
  table.replaceChildren(...d.lines.map((l) => {
    const tr = document.createElement('tr');
    for (const [cls, text] of [['name', l.name], ['qty', l.qty], ['amt', fmt(l.amount)]]) {
      const td = document.createElement('td');
      td.className = cls;
      td.textContent = text;
      tr.append(td);
    }
    return tr;
  }));
  $('total').textContent = fmt(d.total || 0);
  $('change').textContent = d.change ? `Change ${fmt(d.change)}` : '';
  $('message').textContent = d.message || '';
});
