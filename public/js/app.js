document.getElementById('loadOffers').addEventListener('click', async ()=>{
  const res = await fetch('/api/offers');
  const data = await res.json();
  const container = document.getElementById('offers');
  container.innerHTML = '';
  data.forEach(o=>{
    const col = document.createElement('div');
    col.className = 'col-md-4';
    col.innerHTML = `<div class="card mb-3"><div class="card-body">
      <h5 class="card-title">${o.name || o.id}</h5>
      <p class="card-text">Price: ${o.price} ${o.currency}</p>
      <p class="card-text">Validity: ${o.validityDays} days</p>
    </div></div>`;
    container.appendChild(col);
  });
});

document.getElementById('purchaseForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const offerId = document.getElementById('offerId').value;
  const destinationMsisdn = document.getElementById('msisdn').value;
  const res = await fetch('/api/purchase', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ offerId, destinationMsisdn })
  });
  const data = await res.json();
  document.getElementById('purchaseResult').innerHTML = '<pre>'+JSON.stringify(data,null,2)+'</pre>';
});
