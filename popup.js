document.addEventListener("DOMContentLoaded", () => {
	const menuToggle = document.getElementById("menuToggle");
	const menu = document.getElementById("menu");
	const settingsButton = document.getElementById("settingsButton");
	const chatArea = document.getElementById("chatArea");
	const settingsPanel = document.getElementById("settingsPanel");
	const messageForm = document.getElementById("messageForm");
	const messageInput = document.getElementById("messageInput");
	const messages = document.getElementById("messages");
	const emptyState = document.getElementById("emptyState");
	const settingsForm = document.getElementById("settingsForm");
	const closeSettings = document.getElementById("closeSettings");
	const overlay = document.getElementById("overlay");
	const newChatButton = document.getElementById("newChatButton");
	const conversationsList = document.getElementById("conversationsList");
	const autoRunToggle = document.getElementById("autoRunToggle");
	const settingsMessage = document.getElementById("settingsMessage");
	const autoRunToggleContainer = document.getElementById(
		"autoRunToggleContainer"
	);
	const welcomeheader = document.getElementById("welcomeheader");
	const example1 = document.getElementById("example1");
	const example2 = document.getElementById("example2");
	const example3 = document.getElementById("example3");

	let currentConversation = null;
	let pageContent = null;
	let originalSettings = {};

	example1.addEventListener("click", exampleInputPopulate);
	example2.addEventListener("click", exampleInputPopulate);
	example3.addEventListener("click", exampleInputPopulate);

	function exampleInputPopulate(e) {
		const datavalue = e.currentTarget.getAttribute("data-value");
		messageInput.value = datavalue;
	}

	function uncheckHamburger() {
		document.getElementById("menuToggleInput").checked = false;
	}

	menuToggle.addEventListener("change", toggleMenu);
	overlay.addEventListener("click", () => {
		toggleMenu();
		uncheckHamburger();
	});
	newChatButton.addEventListener("click", () => {
		uncheckHamburger();
		startNewChat();
		toggleMenu();
	});

	autoRunToggleContainer.addEventListener("click", (e) => {
		if (e.target !== autoRunToggle) {
			autoRunToggle.checked = !autoRunToggle.checked;
			autoRunToggle.dispatchEvent(new Event("change"));
		}
	});

	autoRunToggle.addEventListener("click", (e) => {
		e.stopPropagation();
	});

	autoRunToggle.addEventListener("change", (e) => {
		if (currentConversation) {
			currentConversation.autoRun = e.target.checked;
			saveCurrentConversation();
		}
	});

	function toggleMenu() {
		menu.classList.toggle("active");
		overlay.classList.toggle("active");
	}

	settingsButton.addEventListener("click", () => {
		chatArea.classList.add("hidden");
		settingsPanel.classList.remove("hidden");
		toggleMenu();
	});

	closeSettings.addEventListener("click", () => {
		uncheckHamburger();
		discardSettingsChanges();
		toggleSettingsPanel();
		reloadExtensionUI();
	});

	messageForm.addEventListener("submit", (e) => {
		e.preventDefault();
		const message = messageInput.value.trim();
		if (message) {
			sendMessage(message);
			messageInput.value = "";
		}
	});

	settingsForm.addEventListener("submit", (e) => {
		e.preventDefault();
		saveSettings();
	});

	function toggleSettingsPanel() {
		chatArea.classList.toggle("hidden");
		settingsPanel.classList.toggle("hidden");
		if (settingsPanel.classList.contains("hidden")) {
			discardSettingsChanges();
			settingsMessage.classList.add("hidden");
		}
	}

	function startNewChat() {
		currentConversation = {
			id: Date.now().toString(),
			messages: [],
			autoRun: false,
			urlMatch: "",
		};
		chrome.tabs.query(
			{ active: true, currentWindow: true },
			function (tabs) {
				currentTabId = tabs[0].id;
				chrome.runtime.sendMessage({
					action: "setMostRecentConversation",
					conversationId: null,
					activeTabId: currentTabId,
				});
			}
		);
		messages.innerHTML = "";
		autoRunToggleContainer.classList.add("hidden");
		updateEmptyState();
		loadConversations();
	}

	function jsonParser(blob) {
		// sometimes the json is stringified twice
		// not sure if this is gemini or the extension logic
		let parsed = JSON.parse(blob);
		if (typeof parsed === "string") parsed = jsonParser(parsed);
		return parsed;
	}

	function sendMessage(userQuery) {
		if (!currentConversation) {
			startNewChat();
		}

		displayMessage("user", userQuery);
		showLoadingIndicator();
		scrollToBottom();

		currentConversation.loading = true;
		saveCurrentConversation();

		if (!pageContent) {
			getPageContent().then(() => {
				sendMessageToBackground(userQuery);
			});
		} else {
			sendMessageToBackground(userQuery);
		}
	}
	function updateConversationWithResponse(userQuery, parsedResponse) {
		currentConversation.messages.push(
			{
				role: "user",
				parts: [{ text: userQuery }],
				timestamp: Date.now(),
			},
			{
				role: "model",
				parts: [{ text: JSON.stringify(parsedResponse) }],
				timestamp: Date.now(),
			}
		);
		currentConversation.loading = false;
		currentConversation.urlMatch = parsedResponse.urlmatch;

		saveCurrentConversation(() => {
			hideLoadingIndicator();
			displayMessage("model", parsedResponse.friendly_message);
			displayScriptBlock(parsedResponse.userscript);
			scrollToBottom();
			loadConversations();
		});
	}
	function sendMessageToBackground(userQuery) {
		chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
			const message = {
				action: "sendMessage",
				userQuery: userQuery,
				currentUrl: pageContent.url,
				domContent: pageContent.domContent,
				conversationHistory: currentConversation.messages,
				activeTabId: tabs[0].id,
				conversationId: currentConversation.id,
			};

			chrome.runtime.sendMessage(message, (response) => {
				if (chrome.runtime.lastError) {
					console.error(
						"Error sending message:",
						chrome.runtime.lastError
					);
					handleSendMessageError("Error sending message");
					return;
				}

				if (response.success) {
					try {
						const parsedResponse = JSON.parse(response.response);
						updateConversationWithResponse(
							userQuery,
							parsedResponse
						);
					} catch (error) {
						console.error("Error parsing response:", error);

						handleSendMessageError("Error parsing response");
					}
				} else {
					handleSendMessageError(response.error);
				}
			});
		});
	}

	function scrollToBottom() {
		chatArea.scrollTo({ top: chatArea.scrollHeight, behavior: "smooth" });
	}

	function setScrollToBottom() {
		chatArea.scrollTo({ top: chatArea.scrollHeight, behavior: "instant" });
	}

	function getPageContent(retries = 3) {
		return new Promise((resolve, reject) => {
			function attemptGetContent() {
				chrome.tabs.query(
					{ active: true, currentWindow: true },
					(tabs) => {
						if (chrome.runtime.lastError) {
							console.error(
								"Error querying tabs:",
								chrome.runtime.lastError
							);
							reject("Error querying tabs");
							return;
						}

						const currentTab = tabs[0];
						if (!currentTab) {
							console.error("No active tab found");
							reject("No active tab found");
							return;
						}

						chrome.tabs.sendMessage(
							currentTab.id,
							{ action: "getPageContent" },
							(response) => {
								if (chrome.runtime.lastError) {
									console.error(
										"Error getting page content:",
										chrome.runtime.lastError
									);
									if (retries > 0) {
										setTimeout(
											() => attemptGetContent(),
											1000
										);
										retries--;
									} else {
										reject(
											"Error getting page content after multiple attempts"
										);
									}
									return;
								}

								pageContent = response;
								resolve();
							}
						);
					}
				);
			}

			attemptGetContent();
		});
	}

	function handleSendMessageError(errorMessage) {
		hideLoadingIndicator();
		// displayMessage("error", "Error: " + errorMessage);
		console.error("Error in sendMessage:", errorMessage);

		const messageElement = document.createElement("div");
		messageElement.classList.add("message", "error");
		const bubbleElement = document.createElement("div");
		bubbleElement.classList.add("bubble");
		bubbleElement.innerHTML = `
				<details>
					<summary>Error: Something went wrong</summary>
					<span>${errorMessage}</span>
				</details>`;
		messageElement.appendChild(bubbleElement);
		messages.appendChild(messageElement);
		messages.scrollTop = messages.scrollHeight;
		currentConversation.loading = false;
		updateEmptyState();
	}

	function displayScriptBlock(userscript) {
		const lastMessageElement = document.querySelector(
			".message.model:last-child"
		);

		if (!lastMessageElement) {
			console.error("No existing model message to append to.");
			return;
		}

		const runButtonContainer = document.createElement("div");
		runButtonContainer.classList.add("runscriptbutton");

		const runButtonIcon = document.createElement("img");
		runButtonIcon.src = "./images/icons/wand.svg";
		runButtonIcon.alt = "wand icon";

		const runButtonText = document.createElement("span");
		runButtonText.textContent = "Run Script";

		runButtonContainer.appendChild(runButtonIcon);
		runButtonContainer.appendChild(runButtonText);

		runButtonContainer.addEventListener("click", () => {
			chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
				const message = {
					action: "runUserScript",
					script: userscript,
					activeTabId: tabs[0].id,
				};

				chrome.runtime.sendMessage(message, (response) => {
					if (chrome.runtime.lastError) {
						console.error(
							"Error sending message:",
							chrome.runtime.lastError
						);
						handleSendMessageError("Error sending message");
						return;
					}

					if (response.success) {
						displayMessage("model", "Script executed successfully");
					} else {
						handleSendMessageError(
							response.error || "Unknown error occurred"
						);
					}
				});
			});
		});

		lastMessageElement.appendChild(runButtonContainer);
		lastMessageElement.scrollTop = lastMessageElement.scrollHeight;
	}

	function displayMessage(sender, content) {
		const messageElement = document.createElement("div");
		messageElement.classList.add("message", sender);
		const bubbleElement = document.createElement("div");
		bubbleElement.classList.add("bubble");
		bubbleElement.textContent = content;
		messageElement.appendChild(bubbleElement);
		messages.appendChild(messageElement);
		messages.scrollTop = messages.scrollHeight;
		updateEmptyState();
	}

	function updateEmptyState() {
		emptyState.style.display =
			messages.children.length === 0 ? "flex" : "none";
	}

	function createModelMessageElement() {
		const messageElement = document.createElement("div");
		messageElement.classList.add("message", "model");
		const bubbleElement = document.createElement("div");
		bubbleElement.classList.add("bubble");
		messageElement.appendChild(bubbleElement);
		messages.appendChild(messageElement);
		return messageElement;
	}

	function showLoadingIndicator() {
		const existingLoadingElement = document.querySelector(
			".message.model.loading"
		);
		if (!existingLoadingElement) {
			const loadingElement = createModelMessageElement();
			loadingElement.classList.add("loading");
			loadingElement.querySelector(".bubble").innerHTML =
				'<div class="shimmer"></div>';
		}
	}

	function hideLoadingIndicator() {
		const loadingElement = document.querySelector(".message.model.loading");
		if (loadingElement) {
			loadingElement.remove();
		}
	}
	function saveSettings() {
		const settings = {
			apiVersion:
				document.getElementById("apiVersion").options[
					document.getElementById("apiVersion").selectedIndex
				].value,
			apiKey: document.getElementById("apiKey").value,
			systemPrompt: document.getElementById("systemPrompt").value,
			userName: document.getElementById("userName").value,
			userLocation: document.getElementById("userLocation").value,
			userLocale: document.getElementById("userLocale").value,
			showActiveCount: document.getElementById("showActiveCount").value,
			hideConversations:
				document.getElementById("hideConversations").checked,
		};

		chrome.storage.sync.set(settings, () => {
			settingsMessage.classList.remove("hidden");
			originalSettings = { ...settings };
			reloadExtensionUI();
		});

		settingsMessage.classList.remove("hidden");

		setTimeout(() => {
			settingsMessage.classList.add("hidden");
		}, 3000);
	}

	function loadSettings() {
		chrome.storage.sync.get(
			[
				"apiVersion",
				"apiKey",
				"systemPrompt",
				"userName",
				"userLocation",
				"userLocale",
				"hideConversations",
				"showActiveCount",
			],
			(result) => {
				document.getElementById("apiVersion").value =
					result.apiVersion || "gemini-1.5-flash";
				document.getElementById("apiKey").value = result.apiKey || "";
				document.getElementById("systemPrompt").value =
					result.systemPrompt || "";
				document.getElementById("userName").value =
					result.userName || "";
				document.getElementById("userLocation").value =
					result.userLocation || "";
				document.getElementById("userLocale").value =
					result.userLocale || "en-US";
				document.getElementById("hideConversations").checked =
					result.hideConversations || false;
				document.getElementById("showActiveCount").checked =
					result.showActiveCount || false;

				originalSettings = { ...result };
			}
		);
	}

	function discardSettingsChanges() {
		document.getElementById("apiVersion").value =
			originalSettings.apiVersion || "gemini-1.5-flash";
		document.getElementById("apiKey").value = originalSettings.apiKey || "";
		document.getElementById("systemPrompt").value =
			originalSettings.systemPrompt || "";
		document.getElementById("userName").value =
			originalSettings.userName || "";
		document.getElementById("userLocation").value =
			originalSettings.userLocation || "";
		document.getElementById("userLocale").value =
			originalSettings.userLocale || "";
		document.getElementById("hideConversations").checked =
			originalSettings.hideConversations || false;
		document.getElementById("showActiveCount").checked =
			originalSettings.showActiveCount || false;
	}

	function reloadExtensionUI() {
		loadWelcomeHeader();
		loadConversations();
		updateEmptyState();
	}

	function loadConversations() {
		chrome.tabs.query(
			{ active: true, currentWindow: true },
			function (tabs) {
				const currentTabUrl = tabs[0].url;
				const currentTabId = tabs[0].id;

				chrome.storage.sync.get("hideConversations", (settings) => {
					chrome.storage.local.get(null, (result) => {
						const conversations = Object.entries(result)
							.filter(
								([, value]) =>
									typeof value === "object" &&
									value.messages &&
									value.messages.length > 0
							)
							.sort(
								([, a], [, b]) =>
									(b.messages[0].timestamp || 0) -
									(a.messages[0].timestamp || 0)
							);

						conversationsList.innerHTML = "";
						conversations.forEach(([id, conversation]) => {
							const regex = conversation.urlMatch.replace(
								/\*/g,
								"[^ ]*"
							);
							const urlPattern = new RegExp(regex);

							if (
								!settings.hideConversations ||
								urlPattern.test(currentTabUrl)
							) {
								const li = document.createElement("li");
								try {
									const lastMessage =
										conversation.messages[
											conversation.messages.length - 1
										];
									if (lastMessage.role === "model") {
										const parsedResponse = jsonParser(
											lastMessage.parts[0].text
										);
										li.textContent =
											parsedResponse.title ||
											"Untitled Conversation";
									} else {
										li.textContent = "User Query";
									}
								} catch (error) {
									console.error(
										"Error parsing conversation title:",
										error
									);
									li.textContent = "Untitled Conversation";
								}
								li.classList.add(id);
								if (conversation.autoRun) {
									li.classList.add("autorun");
								}

								if (id === currentConversation?.id) {
									li.classList.add("active");
								}

								li.addEventListener("click", (e) => {
									const allLi =
										document.querySelectorAll("li");
									allLi.forEach((li) => {
										li.classList.remove("active");
									});
									e.target.classList.add("active");
									loadConversation(id, true);
								});

								const deleteButton =
									document.createElement("button");
								const img = document.createElement("img");
								img.src = "./images/icons/trash.svg";
								img.alt = "Helix Logo";
								img.id = "dotsicon";
								deleteButton.appendChild(img);
								deleteButton.classList.add(
									"delete-conversation"
								);
								deleteButton.addEventListener("click", (e) => {
									e.stopPropagation();
									deleteConversation(id);
								});

								li.appendChild(deleteButton);
								conversationsList.appendChild(li);
							}
						});
					});
				});
			}
		);
	}

	function loadConversation(id, shouldToggleMenu = false) {
		uncheckHamburger();
		chrome.storage.local.get(id, (result) => {
			if (result[id]) {
				autoRunToggleContainer.classList.remove("hidden");

				currentConversation = result[id];
				displayConversation(currentConversation);
				autoRunToggle.checked = currentConversation.autoRun;
				if (shouldToggleMenu) {
					toggleMenu();
				}
				setScrollToBottom();

				chrome.runtime.sendMessage({
					action: "setMostRecentConversation",
					conversationId: id,
					activeTabId: currentTabId,
				});

				updateActiveConversationInList(id);

				if (currentConversation.loading) {
					pollForConversationUpdates(id);
				}
			} else {
				console.error("Conversation not found in local storage:", id);
				startNewChat();
			}
		});
	}

	function pollForConversationUpdates(id) {
		const pollInterval = setInterval(() => {
			chrome.storage.local.get(id, (result) => {
				if (result[id] && !result[id].loading) {
					clearInterval(pollInterval);
					loadConversations();
					loadConversation(id);
				}
			});
		}, 1000);
	}

	function updateActiveConversationInList(id) {
		const allLi = document.querySelectorAll("#conversationsList li");
		allLi.forEach((li) => {
			li.classList.remove("active");
			if (li.classList.contains(id)) {
				li.classList.add("active");
			}
		});
	}

	function displayConversation(conversation) {
		messages.innerHTML = "";
		conversation.messages.forEach((msg, index) => {
			switch (msg.role) {
				case "user":
					displayMessage(msg.role, msg.parts[0].text);
					break;
				case "model":
					try {
						const parsedResponse = jsonParser(msg.parts[0].text);

						displayMessage(
							msg.role,
							parsedResponse.friendly_message
						);
						displayScriptBlock(parsedResponse.userscript);
					} catch (error) {
						console.error("Error parsing stored response:", error);
						displayMessage(
							msg.role,
							"Error: Could not display this message"
						);
					}
					break;
			}
		});

		if (conversation.loading) {
			showLoadingIndicator();
		}

		updateEmptyState();
	}

	function deleteConversation(id) {
		chrome.runtime.sendMessage(
			{
				action: "deleteConversation",
				conversationId: id,
			},
			() => {
				if (currentConversation && id === currentConversation.id) {
					chrome.tabs.query(
						{ active: true, currentWindow: true },
						(tabs) => {
							chrome.runtime.sendMessage({
								action: "deleteMostRecentConversation",
								conversationId: currentConversation.id,
								activeTabId: tabs[0].id,
							});
						}
					);
					startNewChat();
				}

				loadConversations();
			}
		);
	}

	function saveCurrentConversation(callback) {
		if (currentConversation) {
			chrome.runtime.sendMessage(
				{
					action: "saveConversation",
					conversationId: currentConversation.id,
					conversation: currentConversation,
				},
				(response) => {
					if (chrome.runtime.lastError) {
						console.error(chrome.runtime.lastError);
						if (callback) callback(false);
						return;
					}
					chrome.tabs.query(
						{ active: true, currentWindow: true },
						(tabs) => {
							if (tabs && tabs.length > 0) {
								chrome.runtime.sendMessage(
									{
										action: "setMostRecentConversation",
										conversationId: currentConversation.id,
										activeTabId: tabs[0].id,
									},
									(response) => {
										if (chrome.runtime.lastError) {
											console.error(
												chrome.runtime.lastError
											);
											if (callback) callback(false);
										} else {
											if (callback) callback(true);
										}
									}
								);
							} else {
								console.error("No active tab found");
								if (callback) callback(false);
							}
						}
					);
				}
			);
		} else {
			console.error("Current conversation is undefined");
			if (callback) callback(false);
		}
	}

	function loadWelcomeHeader() {
		chrome.storage.sync.get("userName", (result) => {
			welcomeheader.textContent = result.userName
				? `Hello, ${result.userName}!`
				: "Hello!";
		});
	}

	function init() {
		loadSettings();
		loadWelcomeHeader();
		updateEmptyState();
		loadConversations();
		chrome.tabs.query(
			{ active: true, currentWindow: true },
			function (tabs) {
				currentTabId = tabs[0].id;

				chrome.runtime.sendMessage(
					{
						action: "getMostRecentConversation",
						activeTabId: currentTabId,
					},
					(response) => {
						if (response.conversationId) {
							loadConversation(response.conversationId, true);
							toggleMenu();
							loadConversations();
						}
					}
				);
			}
		);
	}

	init();
});
