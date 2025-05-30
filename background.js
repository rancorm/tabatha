// background.js

console.log("Background script running");

// In-memory cache for real-time tracking
let tabData = {};

// Groups with days for age calculation
let rootGroups = [];

const defaultRootGroups = [
  { name: "Today", days: 0 },
  { name: "Yesterday", days: 1  },
  { name: "Last Week", days: 7 },
  { name: "Older", days: 14 }
];

const msInDay = 24 * 60 * 60 * 1000;
const debounceTimeout = 30000;

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
 
  chrome.alarms.create('scheduledTask', { delayInMinutes });

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
  'scheduledHour',
  'scheduledMinute',
  'rootGroups'
];

chrome.storage.local.get(localStorage, (result) => {
  tabData = result.tabData || {};
  const hour = result.scheduledHour;
  const minute = result.scheduledMinute;

  if (hour !== undefined && minute !== undefined) {
    scheduleAlarm(hour, minute);
  }

  rootGroups = result.rootGroups || defaultRootGroups;

  console.log("Local storage loaded");
});

// Track tab creation time
chrome.tabs.onCreated.addListener((tab) => {
  const ts = Date.now();

  tabData[tab.id] = {
    created: ts,
  };

  debounceSave();
});

// Track tab removal
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabData[tabId]) {
    delete tabData[tabId];

    debounceSave();
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'scheduledTask') {
    removeOrphanTabData();
    groupTabsByTime();

    // Reschedule for the next day
    chrome.storage.local.get(['scheduledHour', 'scheduledMinute'], (result) => {
      scheduleAlarm(result.scheduledHour,
	result.scheduledMinute);
    });
  }
});

function createTabGroup(name) {
  chrome.tabs.create({}, (tab) => {
    chrome.tabs.group({ tabIds: tab.id }, (groupId) => {
      chrome.tabGroups.update(groupId, {
	title: name,
	collapsed: true
      });
    });
  });
}

function createTabGroups() {
  chrome.tabGroups.query({}, (groups) => {
    const existingTitles = new Set(groups.map(group => group.title));
    const missingGroupNames = rootGroups
      .filter(group => !existingTitles.has(group.name))
      .map(group => group.name);

    missingGroupNames.forEach(name => {
      createTabGroup(name);
    });

    if (missingGroupNames.length) {
      const foundGroups = groups.filter(group =>
        rootGroups.map(g => g.name).includes(group.title)
      );
      
      console.log(`Found groups: ${foundGroups}`);
      console.log(`Create missing groups: ${missingGroupNames}`);
    } else {
      console.log("Groups already exist");
    }
  });
}

function daysAgo(created, now = Date.now()) {
  return Math.floor((now - created) / msInDay); 
}

function ageToGroup(age) {
  return rootGroups.reduce((best, group) => {
    return (group.days <= age && (!best || group.days > best.days)) ? group : best;
  }, null);
}

function groupTabsByTime() {
  chrome.tabs.query({}, tabs => {
    const groups = {};

    // Initialize group arrays
    rootGroups.forEach(group => {
      groups[group.name] = [];
    });

    // First, get all existing tab groups and map titles to IDs
    chrome.tabGroups.query({}, existingGroups => {
      const groupTitlesToId = {};

      existingGroups.forEach(group => {
        if (group.title) groupTitlesToId[group.title] = group.id;
      });

      tabs.forEach(tab => {
        const td = tabData[tab.id];
        
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

        groups[group.name].push(tab.id);

	console.log(`Move tab (id: ${tab.id}) to group "${group.name}"`);
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

  console.log("Tabs moved to groups");

}

function removeOrphanTabData() {
  for (const key in tabData) {
    if (tabData.hasOwnProperty(key)) {
      chrome.tabs.get(Number(key), function(tab) {
	if (chrome.runtime.lastError) {
	  delete tabData[key];

	  console.log(`Remove orphan tab (id: ${key}) data`);
	} else {
	  console.log(`Tab (id: ${key}) is valid`);
	}
      });
    }
  }
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

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.type === "reloadOptions") {
    const reloadOptions = [
      'scheduledHour',
      'scheduledMinute',
      'rootGroups'
    ];

    chrome.storage.local.get(reloadOptions, (result) => {
      rootGroups = result.rootGroups || defaultRootGroups;

      scheduleAlarm(
	result.scheduledHour,
	result.scheduledMinute);
    
      createTabGroups();
    });

    console.log("Reload options");
  }
});

chrome.runtime.onStartup.addListener(() => {
  createTabGroups();
  removeOrphanTabData();
  groupTabsByTime();
});

chrome.runtime.onInstalled.addListener(() => {
  createTabGroups();
});
