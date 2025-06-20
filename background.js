// background.js

const version = chrome.runtime.getManifest().version;

console.log(`Version: ${version}`);
console.log("Background script running");

// Local storage globals
let tabData = {};
let tabGroups = [];
let sortOnStartup = true;

const defaultTabGroups = [
  { name: "Today", days: 0 },
  { name: "Yesterday", days: 1 },
  { name: "This Week", days: 2 },
  { name: "Last Week", days: 7 },
  { name: "Older", days: 14 }
];

const msInDay = 24 * 60 * 60 * 1000;
const debounceTimeout = 5000;

// Helper functions
const scheduleAlarm = ((hour, minute) => {
  const now = new Date();
  const next = new Date();

  hour = isNaN(hour) ? 4 : hour;
  minute = isNaN(minute) ? 0 : minute;
  
  next.setHours(hour, minute, 0, 0);
  
  // Schedule for next day if time has passed
  if (next <= now) next.setDate(next.getDate() + 1);

  const delayInMinutes = (next - now) / 60000;
 
  chrome.alarms.create('scheduleTask', { delayInMinutes });

  console.log("Task will run again in", delayInMinutes, "minutes");
});

const debounceSave = (() => {
  let timeout;

  return () => {
    clearTimeout(timeout);

    // Save tab data on timeout
    timeout = setTimeout(() => {
      chrome.storage.local.set({ tabData });

      console.log("Save tab data");
    }, debounceTimeout);
  };
})();

// Load local extension storage on startup
const localStorage = [
  'tabData',
  'tabGroups',
  'scheduleHour',
  'scheduleMinute',
  'sortOnStartup'
];

// Track tab removal
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabData[tabId]) {
    delete tabData[tabId];

    console.log(`Remove tab (id: ${tabId})`);

    debounceSave();
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'scheduleTask') {
    console.log("Schedule task");

    removeOrphanTabData().then(() => {
      groupTabsByTime();
    });

    // Reschedule for the next day
    chrome.storage.local.get(['scheduleHour', 'scheduleMinute'], (result) => {
      scheduleAlarm(result.scheduleHour,
	result.scheduleMinute);
    });
  }
});

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.type === "reloadOptions") {
    const reloadOptions = [
      'scheduleHour',
      'scheduleMinute',
      'tabGroups',
      'sortOnStartup'
    ];

    chrome.storage.local.get(reloadOptions, (result) => {
      tabGroups = result.tabGroups || defaultTabGroups;
      sortOnStartup = result.sortOnStartup;

      scheduleAlarm(
	result.scheduleHour,
	result.scheduleMinute);
    
      createTabGroups();
    });

    console.log("Reload options");
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const storageData = await loadLocalStorage();

  const hour = storageData.scheduleHour;
  const minute = storageData.scheduleMinute;
  const sort = storageData.sortOnStartup;

  if (hour !== undefined && minute !== undefined) {
    scheduleAlarm(hour, minute);
  }

  tabData = storageData.tabData || {};
  tabGroups = storageData.tabGroups || defaultTabGroups;
  sortOnStartup = sort;

  createTabGroups().then(() => {
    if (sortOnStartup) {
      console.log("Sorting tabs (startup)");

      removeOrphanTabData().then(() => {
	groupTabsByTime();
      });
    }
  });
});

chrome.runtime.onInstalled.addListener((details) => {
  const reason = details.reason;

  console.log(`Reason: ${reason}`);

  // Create tab groups and populate data with current tabs
  createTabGroups().then(async () => {
    const storageData = await loadLocalStorage();
    const tabDataLen = Object.keys(storageData.tabData).length;

    if (reason === "update") {
      if (tabDataLen) {
	tabData = storageData.tabData;

	console.log("Found existing tab data"); 
      }
    } else if (reason === "install") {
      if (tabDataLen == 0) {
	const ts = Date.now(); 
	
	console.log("No tab data found, add current tabs.");
      
	chrome.tabs.query({ pinned: false }, tabs => {
	  tabs.forEach(tab => {
	    const tabId = tab.id;

	    tabData[tabId] = {
	      created: ts,
	    };

	    console.log(`Add current tab (id: ${tabId})`);
	  });
	});
      }
    }
  });
});

// Track tab creation time
chrome.tabs.onCreated.addListener((tab) => {
  const ts = Date.now();
  const tabId = tab.id;

  if (tabData[tabId]) {
    console.log(`Tab (id: ${tabId}) found in data`);
    
    return;
  } else {
    tabData[tabId] = {
      created: ts,
    };

    console.log(`Add tab (id: ${tabId})`);
  }

  // Listen for updates to this tab
  function handleUpdate(updatedTabId, changeInfo, updatedTab) {
    if (updatedTabId === tabId && changeInfo.status === 'complete') {
      // Now the title should be available
      console.log(`Tab update (id: ${updatedTabId}, title: ${updatedTab.title})`);

      // Remove this listener if you only care about the first update
      chrome.tabs.onUpdated.removeListener(handleUpdate);
    }
  }

  chrome.tabs.onUpdated.addListener(handleUpdate);

  debounceSave();
});

async function loadLocalStorage() {
  const result = await chrome.storage.local.get(localStorage);

  console.log("Local storage loaded");
    
  return result;
}

async function createTabGroup(name) {
  const tab = await chrome.tabs.create({});
  const groupId = await chrome.tabs.group({ tabIds: tab.id });
  await chrome.tabGroups.update(groupId, {
    title: name,
    collapsed: true
  });
}

async function createTabGroups() {
  const groups = await chrome.tabGroups.query({});
  const existingTitles = new Set(groups.map(group => group.title));
  const missingGroupNames = tabGroups
    .filter(group => !existingTitles.has(group.name))
    .map(group => group.name);

  // Create missing groups in parallel
  await Promise.all(missingGroupNames.map(createTabGroup));

  // Refresh groups after creation
  const updatedGroups = await chrome.tabGroups.query({});
  const foundGroups = updatedGroups.filter(group =>
    tabGroups.map(g => g.name).includes(group.title)
  );

  if (missingGroupNames.length) {
    console.log(`Found groups: ${foundGroups.map(g => g.title)}`);
    console.log(`Created missing groups: ${missingGroupNames}`);
  } else {
    console.log("Groups already exist");
  }
}

function daysAgo(created, now = Date.now()) {
  const d1 = new Date(created);
  const d2 = new Date(now);

  // Set both dates to midnight local time
  d1.setHours(0, 0, 0, 0);
  d2.setHours(0, 0, 0, 0);

  return Math.floor((d2 - d1) / msInDay); 
}

function ageToGroup(age) {
  return tabGroups.reduce((best, group) => {
    return (group.days <= age && (!best || group.days > best.days)) ? group : best;
  }, null);
}

function groupTabsByTime() {
  chrome.tabs.query({ pinned: false }, tabs => {
    const groups = {};

    // Initialize group arrays
    tabGroups.forEach(group => {
      groups[group.name] = [];
    });

    // First, get all existing tab groups and map titles to IDs
    chrome.tabGroups.query({}, existingGroups => {
      const groupTitlesToId = {};

      existingGroups.forEach(group => {
        if (group.title) groupTitlesToId[group.title] = group.id;
      });

      tabs.forEach(tab => {
	const tabId = tab.id;
        const td = tabData[tabId];
        
	if (!td) return;

        const tabAge = daysAgo(td.created);
        const group = ageToGroup(tabAge);

        if (!group) return;

        // Check if the group already exists and if the tab is already in it
        const targetGroupId = groupTitlesToId[group.name];
        
	if (targetGroupId !== undefined && tab.groupId === targetGroupId) {
          // Tab is already in the correct group, skip it
          return;
        }

        groups[group.name].push(tabId);

	console.log(`Move tab (id: ${tabId}) to group "${group.name}"`);
      });

      // Move tabs to their respective groups
      Object.entries(groups).forEach(([groupName, tabIds]) => {
        if (tabIds.length === 0) return;

        if (groupTitlesToId[groupName]) {
          chrome.tabs.group({ groupId: groupTitlesToId[groupName], tabIds });
        } else {
          chrome.tabs.group({ tabIds }, groupId => {
            chrome.tabGroups.update(groupId, { title: groupName });
          });
        }
      });
    });
  });

  console.log("Move tabs to groups");
}

async function removeOrphanTabData() {
  const keys = Object.keys(tabData);

  await Promise.all(keys.map(key =>
    new Promise(resolve => {
      chrome.tabs.get(Number(key), function(tab) {
	if (chrome.runtime.lastError) {
	  delete tabData[key];
	}

	resolve();
      });
    })
  ));
}

function printTabData() {
  tabDataLen = Object.keys(tabData).length;

  console.log(`Totals: ${tabDataLen}`);

  for (const key in tabData) {
    if (tabData.hasOwnProperty(key)) {
      tab = tabData[key];
      tabAge = daysAgo(tab.created);

      console.log(`Tab id: ${key}, created: ${tab.created}, age: ${tabAge}`);
    }
  }
}

