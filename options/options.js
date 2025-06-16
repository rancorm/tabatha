// Load saved values
localStorageValues = [
  'scheduleHour',
  'scheduleMinute',
  'sortOnStartup'
]

chrome.storage.local.get(localStorageValues, (result) => {
  document.getElementById('hour').value = result.scheduleHour ?? '';
  document.getElementById('minute').value = result.scheduleMinute ?? '';
  document.getElementById('sort-onstartup').checked = result.sortOnStartup;
});

// Save values when user clicks 'Save'
document.getElementById('save').addEventListener('click', () => {
  const hour = parseInt(document.getElementById('hour').value, 10);
  const minute = parseInt(document.getElementById('minute').value, 10);
  const sort = document.getElementById('sort-onstartup').checked;

  chrome.storage.local.set({
    scheduleHour: hour,
    scheduleMinute: minute,
    sortOnStartup: sort
  });

  document.getElementById('status').textContent = "Options Save!";

  setTimeout(() => document.getElementById('status')
    .textContent = "", 2000);  
  
  // Will trigger reloadOptions message to background script
  saveGroups();


  chrome.runtime.sendMessage({ type: "reloadOptions" });
});

function createGroupRowHTML(name, days) {
  return `
    <td><input type="text" value="${name}" class="name"></td>
    <td><input type="number" value="${days}" class="days"></td>
    <td><button type="button" class="delete">x</button></td>
  `;
}

function loadGroups() {
  chrome.storage.local.get(['tabGroups'], (result) => {
    const groups = result.tabGroups || [
      { name: "Today", days: 0 },
      { name: "Yesterday", days: 1 },
      { name: "This Week", days: 2 },
      { name: "Last Week", days: 7 },
      { name: "Older", days: 14 }
    ];
    
    const tbody = document.querySelector('#groups-table tbody');

    tbody.innerHTML = '';

    groups.forEach((group, index) => {
      const tr = document.createElement('tr');

      tr.innerHTML = createGroupRowHTML(
	group.name,
	group.days);
      
      tbody.appendChild(tr);
    });
  });
}

function saveGroups() {
  const rows = document.querySelectorAll('#groups-table tbody tr');
  const groups = [];

  for (const row of rows) {
    const name = row.querySelector('.name').value.trim();
    const days = parseInt(row.querySelector('.days').value, 10);
    
    if (name && !isNaN(days)) {
      groups.push({ name: name, days: days });
    }
  }

  chrome.storage.local.set({ tabGroups: groups });
}

document.getElementById('add-group').addEventListener('click', () => {
  const tbody = document.querySelector('#groups-table tbody');
  const tr = document.createElement('tr');
  
  tr.innerHTML = createGroupRowHTML("", "0", "");
  
  tbody.appendChild(tr);
});

document.getElementById('groups-table').addEventListener('click', (e) => {
  if (e.target.classList.contains('delete')) {
    e.target.closest('tr').remove();
  }
});

document.getElementById('close').addEventListener('click', (e) => {
  window.close();
});

// Initial load
loadGroups();
