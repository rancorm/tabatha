// background.js
console.log("Loaded and background script running");

// In-memory cache for real-time tracking
let tabData = {};

// Groups with days for age calculation
let rootGroups = [];

const defaultRootGroups = [
  { name: "Today", minDays: 0, maxDays: 0 },
  { name: "Yesterday", minDays: 1, maxDays: 1 },
  { name: "Last Week", minDays: 2, maxDays: 6 },
  { name: "Older", minDays: 7, maxDays: Infinity }
];

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

  console.log("Scheduled task will run again in", delayInMinutes, "minutes");
});

const debounceSave = (() => {
  let timeout;

  return () => {
    clearTimeout(timeout);

    // Save every 30 seconds
    timeout = setTimeout(() => {
      chrome.storage.local.set({ tabData });

      console.log("Save tab data");
    }, 30000);
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
    groupTabsByTime();

    // Reschedule for the next day
    chrome.storage.local.get(['scheduledHour', 'scheduledMinute'], (result) => {
      scheduleAlarm(result.scheduledHour,
	result.scheduledMinute);
    });
  }
});

function createTabGroups() {
  chrome.tabGroups.query({}, (groups) => {
    const existingTitles = new Set(groups.map(group => group.title));
    const missingGroupNames = rootGroups
      .filter(group => !existingTitles.has(group.name))
      .map(group => group.name);

    missingGroupNames.forEach(name => {
      chrome.tabs.create({}, (tab) => {
        chrome.tabs.group({ tabIds: tab.id }, (groupId) => {
          chrome.tabGroups.update(groupId, {
            title: name,
            collapsed: true
          });
        });
      });
    });

    if (missingGroupNames.length) {
      const foundGroups = groups.filter(group =>
        rootGroups.map(g => g.name).includes(group.title)
      );
      console.log("Found groups:", foundGroups);
      console.log("Created missing groups:", missingGroupNames);
    } else {
      console.log("Groups already exist");
    }
  });
}

function groupTabsByTime() {
  chrome.tabs.query({}, tabs => {
    const now = Date.now();
    const groups = {};

    // Initialize group arrays
    rootGroups.forEach(group => {
      groups[group.name] = [];
    });

    tabs.forEach(tab => {
      const td = tabData[tab.id];
      if (!td) return;

      const created = td.created;
      const msInDay = 24 * 60 * 60 * 1000;
      const daysAgo = Math.floor((now - created) / msInDay);

      // Find the matching group
      const group = rootGroups.find(g =>
        daysAgo >= g.minDays && daysAgo <= g.maxDays
      );
      if (group) {
        groups[group.name].push(tab.id);
      }
    });

    chrome.tabGroups.query({}, existingGroups => {
      const groupTitlesToId = {};
      existingGroups.forEach(g => {
        if (g.title) groupTitlesToId[g.title] = g.id;
      });

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
    });

    createTabGroups();

    console.log("Reload root groups");
  }
});

chrome.runtime.onStartup.addListener(() =>{
  createTabGroups();
  groupTabsByTime();
});

chrome.runtime.onInstalled.addListener(() =>{
  createTabGroups();
});
