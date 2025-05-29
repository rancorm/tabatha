// Load saved values
chrome.storage.local.get(['scheduledHour', 'scheduledMinute'], (result) => {
  document.getElementById('hour').value = result.scheduledHour ?? '';
  document.getElementById('minute').value = result.scheduledMinute ?? '';
});

// Save values when user clicks 'Save'
document.getElementById('save').addEventListener('click', () => {
  const hour = parseInt(document.getElementById('hour').value, 10);
  const minute = parseInt(document.getElementById('minute').value, 10);
  
  chrome.storage.local.set({
    scheduledHour: hour,
    scheduledMinute: minute
  });

  saveGroups();
});

function createGroupRowHTML(name, minDays, maxDays) {
  return `
    <td><input type="text" value="${name}" class="name"></td>
    <td><input type="number" value="${minDays}" class="min"></td>
    <td><input type="number" value="${maxDays === Infinity ? '' : maxDays}" class="max"></td>
    <td><button type="button" class="delete">-</button></td>
  `;
}

function loadGroups() {
  chrome.storage.local.get(['rootGroups'], (result) => {
    const groups = result.rootGroups || [
      { name: "Today", minDays: 0, maxDays: 0 },
      { name: "Yesterday", minDays: 1, maxDays: 1 },
      { name: "Last Week", minDays: 2, maxDays: 6 },
      { name: "Older", minDays: 7, maxDays: Infinity }
    ];

    const tbody = document.querySelector('#groupsTable tbody');

    tbody.innerHTML = '';

    groups.forEach((group, index) => {
      const tr = document.createElement('tr');

      tr.innerHTML = createGroupRowHTML(
	group.name,
	group.minDays,
	group.maxDays);
      
      tbody.appendChild(tr);
    });
  });
}

function saveGroups() {
  const rows = document.querySelectorAll('#groupsTable tbody tr');
  const groups = [];

  for (const row of rows) {
    const name = row.querySelector('.name').value.trim();
    const min = parseInt(row.querySelector('.min').value, 10);
    let max = row.querySelector('.max').value.trim();
    
    max = max === '' ? Infinity : parseInt(max, 10);
    
    if (name && !isNaN(min) && !isNaN(max)) {
      groups.push({ name, minDays: min, maxDays: max });
    }
  }

  chrome.storage.local.set({ rootGroups: groups }, () => {
    document.getElementById('status').textContent = "Saved!";
    
    setTimeout(() => document.getElementById('status')
      .textContent = "", 2000);
    
    chrome.runtime.sendMessage({ type: "reloadOptions" });
  });
}

document.getElementById('addGroup').addEventListener('click', () => {
  const tbody = document.querySelector('#groupsTable tbody');
  const tr = document.createElement('tr');
  
  tr.innerHTML = createGroupRowHTML("", "0", "");
  
  tbody.appendChild(tr);
});

document.getElementById('groupsTable').addEventListener('click', (e) => {
  if (e.target.classList.contains('delete')) {
    e.target.closest('tr').remove();
  }
});

// Initial load
loadGroups();
