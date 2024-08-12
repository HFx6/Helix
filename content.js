const MAX_RETRIES = 2;
const TIMEOUT = 5000;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	if (request.action === "getPageContent") {
		const cloneDoc = document.cloneNode(true);

		// replace content with comment
		function replaceContentWithComment(cloneDoc, tagName, commentText) {
			try {
				const elements = cloneDoc.getElementsByTagName(tagName);
				for (let i = elements.length - 1; i >= 0; i--) {
					const comment = cloneDoc.createComment(commentText);
					elements[i].parentNode.replaceChild(comment, elements[i]);
				}
			} catch (error) {
				console.error(`Error replacing ${tagName} content:`, error);
			}
		}

		// remove base64 images
		function removeBase64Images(cloneDoc) {
			try {
				const images = cloneDoc.getElementsByTagName("img");
				for (let i = images.length - 1; i >= 0; i--) {
					if (images[i].src.startsWith("data:image")) {
						const comment = cloneDoc.createComment(
							"Base64 image removed"
						);
						images[i].parentNode.replaceChild(comment, images[i]);
					}
				}

				const elements = cloneDoc.querySelectorAll(
					'[style*="url(data:image"]'
				);
				for (let i = elements.length - 1; i >= 0; i--) {
					const style = elements[i].getAttribute("style");
					const newStyle = style.replace(
						/url\(data:image[^)]+\)/g,
						"/* Base64 image removed */"
					);
					elements[i].setAttribute("style", newStyle);
				}
			} catch (error) {
				console.error("Error removing base64 images:", error);
			}
		}

		function removeSpecificContent(cloneDoc) {
			replaceContentWithComment(
				cloneDoc,
				"script",
				"Script content removed"
			);
			replaceContentWithComment(
				cloneDoc,
				"style",
				"Style content removed"
			);
			replaceContentWithComment(cloneDoc, "svg", "SVG content removed");
			removeBase64Images(cloneDoc);
		}

		function getPageContentWithRetries(retryCount = 0) {
			try {
				removeSpecificContent(cloneDoc);

				const modifiedHTML = cloneDoc.documentElement.outerHTML;

				const pageContent = {
					url: window.location.href,
					domContent:
						modifiedHTML ||
						window.document.documentElement.outerHTML,
				};
				sendResponse(pageContent);
			} catch (error) {
				console.error("Error getting page content:", error);
				if (retryCount < MAX_RETRIES) {
					setTimeout(() => {
						getPageContentWithRetries(retryCount + 1);
					}, TIMEOUT);
				} else {
					sendResponse({ error: "Failed to get page content" });
				}
			}
		}

		getPageContentWithRetries();
	}
	return true;
});
