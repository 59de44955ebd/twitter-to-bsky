// ==UserScript==
// @name           twitter-to-bsky
// @version        0.1
// @description    Crosspost from Twitter to Bluesky
// @author         59de44955ebd
// @license        MIT
// @match          https://twitter.com/*
// @icon           https://abs.twimg.com/favicons/twitter.2.ico
// @grant          GM_addStyle
// @run-at         document-body
// ==/UserScript==

/*
 * Things which surprisingly don't need replacing/renaming as of 2023-08-26:
 *
 *   1. "Scheduled Tweets" are still called "Tweets"
 *   2. "Based on your Retweets" in the "For you" tab. (not sure, needs rechecking)
 *
 * Things deliberately left with the new name:
 *
 *   1. "Post" in "Post Analytics" -- a rarely used feature, don't care.
 *   2. "X Corp." in the copyright line of the "footer" (it's in the right sidebar on the web version)
 *   3. Anything on subdomains: about.twitter.com, developer.twitter.com, etc.
 *   4. Tweets counters in "What's happening". It's algorithmic trash, hide it with https://userstyles.world/style/10864/twitter-hide-trends-and-who-to-follow
 */

(function() {
	'use strict';

    function waitForElement(selector) {
        return new Promise(resolve => {
            const queryResult = document.querySelector(selector);
            if (queryResult) {
                return resolve(queryResult);
            }
            const observer = new MutationObserver(mutations => {
                const queryResult = document.querySelector(selector);
                if (queryResult) {
                    /*
				 * Disconnect first, just in case the listeners
				 * on the returned Promise trigger the observer
				 * again.
				 */
                    observer.disconnect();
                    resolve(queryResult);
                }
            });
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        });
    }

	//const TWITTER_2012_ICON_URL = 'https://abs.twimg.com/favicons/twitter.2.ico';

	const LOG_PREFIX = "[BSKY]";
	const FAVICON_SELECTOR = 'link[rel="icon"], link[rel="shortcut icon"]';

	//const POSTS_SELECTOR = createPostsSelector();

	const DIALOG_TWEET_BUTTON_SELECTOR = 'div[data-testid="tweetButton"] > div > span > span';
    const DIALOG_TOOLBAR_SELECTOR = 'div[data-testid="toolBar"] > div';

	//const RETWEETED_SELECTOR = '[data-testid="socialContext"]';
	//const SHOW_N_TWEETS_SELECTOR = 'main div div section > div > div > div > div div[role="button"] > .css-1dbjc4n.r-16y2uox.r-1wbh5a2.r-1777fci > div > span';

	function error(...toLog) {
		console.error(LOG_PREFIX, ...toLog);
	}

	function warn(...toLog) {
		console.warn(LOG_PREFIX, ...toLog);
	}

	function info(...toLog) {
		console.info(LOG_PREFIX, ...toLog);
	}

	function debug(...toLog) {
		console.debug(LOG_PREFIX, ...toLog);
	}

	/*
	 * Button "Tweet" needs to change dynamically into "Tweet all" when
	 * more than two tweets are added to the "draft".
	 *
	 * This observer detects changes in its text, because the button
	 * actually gets recreated inside the popup dialog.
	 */
	//let tweetButtonObserver = null;

    let bsky_cross_post = true;

    /*
	 * Renames existing "Tweet" buttons in popup dialogs on desktop.
	 */
    function create_button(toolbarDiv) {
        const div = document.createElement("label");
        div.className = 'bsky';
        //btn.innerText = 'Hello!';
        //btn.innerHTML = '<label><input type="checkbox"> BSKY</label>';

        div.style = 'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;font-weight: bold;cursor:pointer;';

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
//         checkbox.name = "name"+json.items[i].name;
//         checkbox.value = "value";
//         checkbox.id = "id"+i;
        checkbox.checked = bsky_cross_post;
        checkbox.onclick = async function(){
            bsky_cross_post = this.checked;

            for (let el of document.querySelectorAll('.bsky input')) {
                el.checked = bsky_cross_post;
            }

            //TMP
            let el = toolbarDiv, dialog;
            while (true) {
                el = el.parentNode;
                if (!el) {
                    break;
                }
                if (el.getAttribute('role') == 'dialog') {
                    info('dialog found');
                    dialog = el;
                    break;
                }
            }

            if (dialog) {
                const div_attachments = dialog.querySelector('[data-testid="attachments"]');
                if (div_attachments)
                {
                    for (let img of div_attachments.querySelectorAll('img')) {
                        info(img.src);
                        const reader = new FileReader();
                        reader.onload = function(){
                            info(this.result); // ArrayBuffer { byteLength: 64630 }
                        }
                        const blob = await fetch(img.src).then(r => r.blob());
                        info(blob); // name, size, type
                        reader.readAsArrayBuffer(blob);
                    }
                }
            }
            else {
                info('dialog not found');
            }

//             const post_btn = toolbarDiv.querySelector('[data-testid="tweetButton"]'); // tweetButtonInline
//             post_btn.onclick = function() {
//                 let el = toolbarDiv, dialog;
//                 while (true) {
//                     el = el.parentNode;
//                     if (!el)
//                         break;
//                     if (el.role == 'dialog') {
//                         info('dialog found');
//                         dialog = el;
//                         break;
//                     }
//                 }
//                 return false;
//             }
        }

        div.appendChild(checkbox);
        div.appendChild(document.createTextNode('BSKY'));
        toolbarDiv.appendChild(div);
    }

	/*
	 * Renames various oval blue buttons used to send a tweet, i.e. "to tweet".
	 */
	function main() {

// 		waitForElement('a[data-testid="SideNav_NewTweet_Button"] > div > span > div > div > span > span').then(tweetButton => {
// 			if (tweetButton.innerText == "Post") { // avoid renaming "Reply"
// 				tweetButton.innerHTML = "Tweet";
// 				debug("SideNav", tweetButton);
// 			}
// 		});

        waitForElement(DIALOG_TOOLBAR_SELECTOR).then(toolbarDiv => {

            //if (!toolbarDiv.querySelector('.bsky')) {
                info('First button added');
                create_button(toolbarDiv);
            //}

			/*
			 * Separate observer is needed to avoid leaking `tweetButtonObserver`
			 * and to reconnect `tweetButtonObserver` onto new buttons, when
			 * they appear.
			 */
			const dialogObserver = new MutationObserver(mutations => {

                //doInsertToolbarButton();

                const toolbarDiv = document.querySelector(DIALOG_TOOLBAR_SELECTOR);
                if (toolbarDiv == null) {
                    return;
                }
                if (!toolbarDiv.querySelector('.bsky')) {
                    info('New button added');
                    create_button(toolbarDiv);
                }

// 				if (document.querySelector('[role="dialog"]') == null) {
// 					tweetButtonObserver.disconnect();
// 					tweetButtonObserver = null;
// 					info("Disconnected tweetButtonObserver");
// 					dialogObserver.disconnect();
// 				}
			});

// 			tweetButtonObserver.observe(document.querySelector('[role="dialog"]'), { childList: true, subtree: true });
// 			info("Connected tweetButtonObserver");

			dialogObserver.observe(document.body, { childList: true, subtree: true });
        });
	}

    //console.log(unsafeWindow.XMLHttpRequest.prototype.onreadystatechange);
    // https://caps.twitter.com/v2/cards/preview.json?status=https%3A%2F%2Fwww.spiegel.de%2Fpanorama%2Fjustiz%2Fmaine-was-ueber-das-schusswaffenmassakar-von-lewiston-bekannt-ist-a-0e11feb8-8e68-4f39-a2ae-1e035d1bddd5&cards_platform=Web-12&include_cards=true

    unsafeWindow.XMLHttpRequest.prototype._open = unsafeWindow.XMLHttpRequest.prototype.open;
//     unsafeWindow.XMLHttpRequest.prototype.open = function(...args) {
//         //do whatever mucking around you want here, e.g.
//         //changing the onload callback to your own version
//         console.log(">>> XMLHttpRequest open:", args);

//         if (args[1].includes('/cards/')) {
//             this.addEventListener("readystatechange", function() {
//                 //console.log(">>> readyState:", this.readyState);
//                 if (this.readyState === 4) {
//                     console.log('>>> RESULT', JSON.parse(this.response));
//                 }
//             }, false);
//         }

//         this._is_tweet = args[1].includes('/CreateTweet');
//         this._open(...args);
//     };

    unsafeWindow.XMLHttpRequest.prototype._send = unsafeWindow.XMLHttpRequest.prototype.send;
//     unsafeWindow.XMLHttpRequest.prototype.send = function(...args) {
//         if (this._is_tweet)
//         {
//             console.log('>>> NEW TWEET', args);
//         }
//         this._send(...args);
//     };

	//waitForElement(FAVICON_SELECTOR).then(ignored => {
		//setFavicon(TWITTER_2012_ICON_URL);
		//setUpRenamer();
        main();
	//});


})();
