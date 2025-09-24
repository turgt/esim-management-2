document.getElementById('listOffersBtn').addEventListener('click', async () => {
  const token = localStorage.getItem('token');
  if (!token) { alert('Please login first'); return; }
  try {
    const res = await fetch('/esims/offers', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await res.json();
    document.getElementById('offers').textContent = JSON.stringify(data,null,2);
  } catch (err) {
    alert('Error: ' + err.message);
  }
});

document.getElementById('purchaseForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = localStorage.getItem('token');
  if (!token) { alert('Please login first'); return; }
  const offerId = document.getElementById('offerId').value;
  try {
    const res = await fetch('/esims/purchase', {
      method:'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':'Bearer ' + token },
      body: JSON.stringify({ offerId })
    });
    const data = await res.json();
    alert('Purchase result: ' + JSON.stringify(data));
  } catch (err) {
    alert('Error: ' + err.message);
  }
});

document.getElementById('qrForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = localStorage.getItem('token');
  if (!token) { alert('Please login first'); return; }
  const txnId = document.getElementById('txnId').value;
  try {
    const res = await fetch('/esims/qrcode/' + txnId, {
      headers: { 'Authorization':'Bearer ' + token }
    });
    if (!res.ok) { throw new Error('Failed to fetch QR'); }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const img = document.createElement('img');
    img.src = url;
    const qrDiv = document.getElementById('qrResult');
    qrDiv.innerHTML = '';
    qrDiv.appendChild(img);
  } catch (err) {
    alert('Error: ' + err.message);
  }
});
