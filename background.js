// background.js

const version = chrome.runtime.getManifest().version;

console.log(`Version: ${version}`);
console.log("Background script running");

// Local storage globals
let tabData = {};
let tabGroups = [];
let sortOnStartup = true;
let startupComplete = false;

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
  let guidToRemove = null;
  
  for (const guid in tabData) {
    if (tabData[guid].tabId === tabId) {
      guidToRemove = guid;
      
      break;
    }
  }
  
  if (guidToRemove) {
    delete tabData[guidToRemove];
    
    console.log(`Remove tab (guid: ${guidToRemove}, id: ${tabId})`);
    
    debounceSave();
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'scheduleTask') {
    console.log("Schedule task");

    await removeOrphanTabData()
    groupTabsByTime();

    // Reschedule for the next day
    result = await chrome.storage.local.get(['scheduleHour', 'scheduleMinute']);
    scheduleAlarm(result.scheduleHour, result.scheduleMinute);
  }
});

chrome.runtime.onMessage.addListener(async function(request, sender, sendResponse) {
  if (request.type === "reloadOptions") {
    const reloadOptions = [
      'scheduleHour',
      'scheduleMinute',
      'tabGroups',
      'sortOnStartup'
    ];

    result = await chrome.storage.local.get(reloadOptions);
    tabGroups = result.tabGroups || defaultTabGroups;
    sortOnStartup = result.sortOnStartup;

    scheduleAlarm(
      result.scheduleHour,
      result.scheduleMinute);
  
    createTabGroups();

    console.log("Reload options");
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const storageData = await loadLocalStorage();
  const hour = storageData.scheduleHour;
  const minute = storageData.scheduleMinute;

  if (hour !== undefined && minute !== undefined) {
    scheduleAlarm(hour, minute);
  }

  tabData = storageData.tabData || {};
  tabGroups = storageData.tabGroups || defaultTabGroups;
  sortOnStartup = storageData.sortOnStartup;

  await createTabGroups();
  
  if (sortOnStartup) {
    console.log("Sorting tabs (startup)");

    groupTabsByTime();
  }

  startupComplete = true;

  console.log("On startup");
});

chrome.runtime.onInstalled.addListener(async (details) => {
  const reason = details.reason;
  const storageData = await loadLocalStorage();
  
  console.log(`Reason: ${reason}`);

  // Create tab groups and populate data with current tabs
  await createTabGroups();

  if (reason === "update") {
    // Local storage to globals
    tabData = storageData.tabData;
    tabGroups = storageData.tabGroups;
    sortOnStartup = storageData.sortOnStartup;

    console.log("Local storage to globals");
  } else if (reason === "install") {
    const tabDataLen = Object.keys(storageData.tabData).length;
 
    if (tabDataLen == 0) {
      console.log("No tab data found, add current tabs.");

      tabs = await chrome.tabs.query({ pinned: false });
      tabs.forEach(tab => {
	const tabId = tab.id;
	  
	addTab(tab);
	  
	console.log(`Add current tab (id: ${tabId})`);
      });
    }
  }

  startupComplete = true;
});

// Track tab creation time
chrome.tabs.onCreated.addListener((tab) => {
  let foundTab = findTabByFingerprint(tab);
  let tabId = tab.id;

  if (!startupComplete) return;

  if (foundTab) {
    tabId = foundTab.tabId;

    console.log(`Tab (id: ${tabId}) found in data`);
  } else {
    newTab = addTab(tab);

    console.log(`Add tab (guid: ${newTab.guid}, id: ${newTab.tabId})`);
  }

  // Listen for updates to this tab
  function handleUpdate(updatedTabId, changeInfo, updatedTab) {
    if (updatedTabId === tabId && changeInfo.status === 'complete') {
      const foundUpdatedTab = findTabById(updatedTab);
     
      // Update tab data URL when tab updates
      if (foundUpdatedTab) {
	const guid = foundUpdatedTab.guid;

	tabData[guid].fingerprint.url = updatedTab.url;

	console.log(`Tab update (guid: ${guid}, id: ${updatedTabId}, title: ${updatedTab.title})`);

	debounceSave();
      }
    }
  }

  chrome.tabs.onUpdated.addListener(handleUpdate);

  debounceSave();
});

function addTab(tab) {
  const guid = generateGUID();
  const now = Date.now();

  tabData[guid] = {
    guid: guid,
    created: now,
    tabId: tab.id,
    fingerprint: {
      url: tab.url,
      windowId: tab.windowId,
      index: tab.index,
    }
  };

  return tabData[guid];
}

function generateGUID() {
  return crypto.randomUUID();
}

function findTabById(tab) {
  const tabId = tab.id;

  for (const guid in tabData) {
    if (tabData[guid].tabId == tabId) {
      return tabData[guid];
    }
  }

  return null;
}

function findTabByFingerprint(tab) {
  const { url, windowId, index } = tab;

  for (const guid in tabData) {
    const fp = tabData[guid].fingerprint;

    if (
      fp.url === url &&
      fp.windowId === windowId &&
      fp.index === index
    ) {
      return tabData[guid];
    }
  }

  return null;
}

async function removeOrphanTabData() {
  const tabs = await new Promise(resolve => chrome.tabs.query({}, resolve));
  const existingTabIds = new Set(tabs.map(tab => tab.id));
  let changed = false;

  for (const guid in tabData) {
    const entry = tabData[guid];
    const { tabId, fingerprint } = entry;

    // Check for tabId match
    let found = tabId && existingTabIds.has(tabId);

    // If not found by tabId, check for URL and windowId match
    if (!found && fingerprint && fingerprint.url && fingerprint.windowId) {
      found = tabs.some(tab =>
        tab.url === fingerprint.url &&
        tab.windowId === fingerprint.windowId
      );
    }

    // If not found by either method, remove the entry
    if (!found) {
      console.log(`Remove tab (guid: ${guid}, id: ${entry.tabId})`);

      delete tabData[guid];
      
      changed = true;
    }
  }

  if (changed) {
    console.log("Save after orphan data clean up");

    debounceSave();
  }
}

async function loadLocalStorage() {
  const result = await chrome.storage.local.get(localStorage);

  console.log("Load local storage");
    
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

async function groupTabsByTime() {
  const tabs = await chrome.tabs.query({ pinned: false });
  const groups = {};

  // Initialize group arrays
  tabGroups.forEach(group => {
    groups[group.name] = [];
  });

  // First, get all existing tab groups and map titles to IDs
  const existingGroups = await chrome.tabGroups.query({});
  const groupTitlesToId = {};

  existingGroups.forEach(group => {
    if (group.title) groupTitlesToId[group.title] = group.id;
  });

  tabs.forEach(tab => {
    const td = findTabByFingerprint(tab);
    
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

  console.log("Move tabs to groups");
}

function printTabData() {
  tabDataLen = Object.keys(tabData).length;

  console.log(`Totals: ${tabDataLen}`);

  for (const key in tabData) {
    if (tabData.hasOwnProperty(key)) {
      tab = tabData[key];
      tabAge = daysAgo(tab.created);

      console.log(`Tab (guid: ${key}, id: ${tab.tabId}, created: ${tab.created}, age: ${tabAge})`);
    }
  }
}

function appVersion() {
  return version;
}
