const GEMINI_BASE_URL =
	"https://generativelanguage.googleapis.com/v1beta/models/";
const ICON_STATES = Array.from({ length: 16 }, (_, i) => i.toString());

let currentIconState = 0;
let iconAnimationDirection = 1;
let iconAnimationIntervals = {};
let previousIconStates = {};
let browserActiveScriptCount = {};
let mostRecentConversations = {};

function jsonParser(blob) {
	// sometimes the json is stringified twice
	// not sure if this is gemini or the extension logic
	let parsed = JSON.parse(blob);
	if (typeof parsed === "string") parsed = jsonParser(parsed);
	return parsed;
}

const chromeTabs = {
	get: (tabId) => new Promise((resolve) => chrome.tabs.get(tabId, resolve)),
	sendMessage: (tabId, message) =>
		new Promise((resolve) =>
			chrome.tabs.sendMessage(tabId, message, resolve)
		),
	executeScript: (tabId, details) =>
		new Promise((resolve) =>
			chrome.tabs.executeScript(tabId, details, resolve)
		),
};
const chromeBrowserAction = {
	setIcon: (details) =>
		new Promise((resolve) =>
			chrome.browserAction.setIcon(details, resolve)
		),
	setBadgeText: (details) =>
		new Promise((resolve) =>
			chrome.browserAction.setBadgeText(details, resolve)
		),
};
const chromeStorage = {
	sync: {
		get: (keys) =>
			new Promise((resolve) => chrome.storage.sync.get(keys, resolve)),
		set: (items) =>
			new Promise((resolve) => chrome.storage.sync.set(items, resolve)),
	},
	local: {
		get: (keys) =>
			new Promise((resolve) => chrome.storage.local.get(keys, resolve)),
		set: (items) =>
			new Promise((resolve) => chrome.storage.local.set(items, resolve)),
		remove: (keys) =>
			new Promise((resolve) =>
				chrome.storage.local.remove(keys, resolve)
			),
	},
};

chrome.webNavigation.onCommitted.addListener((details) => {
	delete mostRecentConversations[details.tabId];
});

chrome.tabs.onCreated.addListener((tab) => {
	initTabState(tab.id);
	mostRecentConversations[tab.id] = null;
});

chrome.tabs.onRemoved.addListener((tabId) => {
	cleanupTabState(tabId);
});

function initTabState(tabId) {
	iconAnimationIntervals[tabId] = null;
	previousIconStates[tabId] = "ready";
	browserActiveScriptCount[tabId] = 0;
	mostRecentConversations[tabId] = null;
}

function cleanupTabState(tabId) {
	if (iconAnimationIntervals[tabId]) {
		clearInterval(iconAnimationIntervals[tabId]);
	}
	delete iconAnimationIntervals[tabId];
	delete previousIconStates[tabId];
	delete browserActiveScriptCount[tabId];
	delete mostRecentConversations[tabId];
}

function startIconAnimation(tabId) {
	if (!iconAnimationIntervals[tabId]) {
		iconAnimationIntervals[tabId] = setInterval(() => {
			updateIcon(true, tabId);

			currentIconState += iconAnimationDirection;

			if (currentIconState >= ICON_STATES.length - 1) {
				iconAnimationDirection = -1;
			} else if (currentIconState <= 0) {
				iconAnimationDirection = 1;
			}
		}, 55);
	}
}

async function updateIcon(isAnimating = false, tabId) {
	try {
		let iconPath;
		if (isAnimating) {
			iconPath = `./images/loading_anim/FRAME_${ICON_STATES[currentIconState]}.png`;
		} else {
			iconPath = `./images/sparkle_${
				previousIconStates[tabId] || "ready"
			}.png`;
		}
		await chromeBrowserAction.setIcon({ path: iconPath, tabId: tabId });
	} catch (error) {
		cleanupTabState(tabId);
	}
}

function stopIconAnimation(tabId) {
	if (iconAnimationIntervals[tabId]) {
		clearInterval(iconAnimationIntervals[tabId]);
		delete iconAnimationIntervals[tabId];
		updateIcon(false, tabId);
	}
}

async function setIconState(state, tabId) {
	try {
		previousIconStates[tabId] = state;
		const iconPath = `./images/sparkle_${state}.png`;
		await chromeBrowserAction.setIcon({ path: iconPath, tabId: tabId });
	} catch (error) {
		cleanupTabState(tabId);
	}
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
	if (changeInfo.status === "complete") {
		try {
			const { showActiveCount } = await chromeStorage.sync.get([
				"showActiveCount",
			]);
			browserActiveScriptCount[tabId] = 0;
			const result = await chromeStorage.local.get(null);

			let isScriptRunning = false;

			for (const [id, conversation] of Object.entries(result)) {
				// hacky way to prevent bad conversations from breaking the extension
				if (
					conversation?.message?.length === 0 ||
					!conversation?.urlMatch
				) {
					await chromeStorage.local.remove([id]);
					continue;
				}
				const regex = conversation.urlMatch.replace(/\*/g, "[^ ]*");
				const urlPattern = new RegExp(regex);
				if (conversation.autoRun && urlPattern.test(tab.url)) {
					isScriptRunning = true;

					const userscript = jsonParser(
						conversation.messages[conversation.messages.length - 1]
							.parts[0].text
					).userscript;

					await chromeTabs.executeScript(tabId, { code: userscript });

					if (showActiveCount) {
						browserActiveScriptCount[tabId] =
							(browserActiveScriptCount[tabId] || 0) + 1;
						await chromeBrowserAction.setBadgeText({
							text: browserActiveScriptCount[tabId].toString(),
							tabId: tabId,
						});
					}
					await setIconState("active", tabId);
				}
			}

			if (!isScriptRunning) {
				await setIconState("ready", tabId);
			}
		} catch (error) {
			console.error("Error in tab update listener:", error);
		}
	}
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	const tabId = sender.tab ? sender.tab.id : request.activeTabId;

	if (request.action === "sendMessage") {
		sendMessageToGemini(request, tabId)
			.then((response) => {
				saveConversation(
					request.conversationId,
					request.userQuery,
					response,
					tabId
				);
				sendResponse({ success: true, response });
			})
			.catch((error) =>
				sendResponse({ success: false, error: error.message })
			);
		return true;
	}
	if (request.action === "runUserScript") {
		chromeTabs
			.executeScript(tabId, { code: request.script })
			.then((result) => {
				setIconState("active", tabId);
				sendResponse({ success: true, result: result });
			});
		return true;
	}
	if (request.action === "saveConversation") {
		saveConversation(
			request.conversationId,
			null,
			null,
			tabId,
			request.conversation
		);
		sendResponse({ success: true });
		return true;
	}
	if (request.action === "deleteConversation") {
		deleteConversation(request.conversationId);
		sendResponse({ success: true });
		return true;
	}
	if (request.action === "setMostRecentConversation") {
		mostRecentConversations[tabId] = request.conversationId;
		sendResponse({ success: true });
		return true;
	}
	if (request.action === "deleteMostRecentConversation") {
		delete mostRecentConversations[tabId];
		sendResponse({ success: true });
		return true;
	}
	if (request.action === "getMostRecentConversation") {
		sendResponse({
			conversationId: mostRecentConversations[tabId] || null,
		});
		return true;
	}
});

async function deleteConversation(conversationId) {
	await chromeStorage.local.remove(conversationId);
}

async function saveConversation(
	conversationId,
	userQuery,
	response,
	tabId,
	fullConversation = null
) {
	if (fullConversation) {
		await chromeStorage.local.set({ [conversationId]: fullConversation });
	} else {
		const result = await chromeStorage.local.get(conversationId);
		let conversation = result[conversationId] || {
			id: conversationId,
			messages: [],
			autoRun: false,
			urlMatch: "",
		};
		conversation.messages.push(
			{
				role: "user",
				parts: [{ text: userQuery }],
				timestamp: Date.now(),
			},
			{
				role: "model",
				parts: [{ text: JSON.stringify(response) }],
				timestamp: Date.now(),
			}
		);
		conversation.urlMatch = JSON.parse(response).urlmatch;
		conversation.loading = false;
		await chromeStorage.local.set({ [conversationId]: conversation });
	}
}

async function sendMessageToGemini(request, tabId) {
	startIconAnimation(tabId);
	try {
		const {
			apiKey,
			systemPrompt,
			userName,
			userLocation,
			userLocale,
			apiVersion,
		} = await chromeStorage.sync.get([
			"apiKey",
			"systemPrompt",
			"userName",
			"userLocation",
			"userLocale",
			"apiVersion",
		]);

		if (!apiKey) {
			stopIconAnimation(tabId);
			throw new Error(
				"API key is not set. Please set it in the extension settings."
			);
		}

		const cleanedConversationHistory = request.conversationHistory.map(
			({ role, parts }) => ({
				role,
				parts: parts.map(({ text }) => ({ text })),
			})
		);

		const userInfo = `User: ${userName || "Anonymous"}, Location: ${
			userLocation || "Unknown"
		}, Locale: ${userLocale || "en-US"}`;
		const contextInfo = `Current Page: ${request.currentUrl}\nDOM content: ${request.domContent}`;

		let systemInstruction;
		if (apiVersion === "gemini-1.5-flash") {
			systemInstruction = {
				system_instruction: {
					parts: {
						text: systemPrompt,
					},
				},
			};
		} else {
			systemInstruction = {
				systemInstruction: {
					role: "user",
					parts: {
						text: systemPrompt,
					},
				},
			};
		}

		const requestBody = {
			...systemInstruction,
			contents: [
				{
					role: "user",
					parts: [
						{
							text: `${userInfo}\n\n${contextInfo}`,
						},
					],
				},
				...cleanedConversationHistory,
				{
					role: "user",
					parts: [{ text: request.userQuery }],
				},
			],
			generationConfig: {
				temperature: 0.7,
				topK: 64,
				topP: 0.95,
				maxOutputTokens: 8192,
				responseMimeType: "application/json",
			},
			safetySettings: [
				{
					category: "HARM_CATEGORY_HARASSMENT",
					threshold: "BLOCK_NONE",
				},
				{
					category: "HARM_CATEGORY_HATE_SPEECH",
					threshold: "BLOCK_NONE",
				},
				{
					category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
					threshold: "BLOCK_NONE",
				},
				{
					category: "HARM_CATEGORY_DANGEROUS_CONTENT",
					threshold: "BLOCK_NONE",
				},
			],
		};

		const API_ENDPOINT = `${GEMINI_BASE_URL}${apiVersion}:generateContent`;
		const response = await fetch(`${API_ENDPOINT}?key=${apiKey}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(requestBody),
		});

		if (!response.ok) {
			stopIconAnimation(tabId);
			const errorData = await response.text();
			throw new Error(`API error: ${errorData}`);
		}
		stopIconAnimation(tabId);
		const data = await response.json();
		if (
			data.candidates &&
			data.candidates.length > 0 &&
			data.candidates[0].content
		) {
			const responseText = data.candidates[0].content.parts[0].text;

			const parsedResponse = JSON.parse(responseText);
			return JSON.stringify(parsedResponse);
		} else {
			throw new Error("Unexpected API response format");
		}
	} catch (error) {
		stopIconAnimation(tabId);
		console.error("Error in sendMessageToGemini:", error);
		throw error;
	}
}
