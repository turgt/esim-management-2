document.getElementById('statsBtn').addEventListener('click', async () => {
  await fetchAdmin('/admin/stats');
});

document.getElementById('logsBtn').addEventListener('click', async () => {
  await fetchAdmin('/admin/logs');
});

async function fetchAdmin(url) {
  const token = localStorage.getItem('token');
  if (!token) { alert('Please login first'); return; }
  try {
    const res = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await res.json();
    document.getElementById('output').textContent = JSON.stringify(data,null,2);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}
