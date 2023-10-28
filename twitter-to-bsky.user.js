// ==UserScript==
// @name           twitter-to-bsky
// @version        0.1
// @description    Crosspost from Twitter to Bluesky
// @author         59de44955ebd
// @license        MIT
// @match          https://twitter.com/*
// @icon           https://bsky.app/static/favicon-32x32.png
// @grant          GM_setValue
// @grant          GM_getValue
// @grant          GM_addStyle
// @require        https://github.com/59de44955ebd/twitter-to-bsky/raw/main/bsky.js
// @updateURL      https://github.com/59de44955ebd/twitter-to-bsky/raw/main/twitter-to-bsky.meta.js
// @downloadURL    https://github.com/59de44955ebd/twitter-to-bsky/raw/main/twitter-to-bsky.user.js
// @run-at         document-body
// ==/UserScript==

(function() {
	'use strict';

    // config
    const LOG_PREFIX = "[BSKY]";
    //const FAVICON_SELECTOR = 'link[rel="icon"], link[rel="shortcut icon"]';
    const DIALOG_TWEET_BUTTON_SELECTOR = 'div[data-testid="tweetButton"] > div > span > span';
    const DIALOG_TOOLBAR_SELECTOR = 'div[data-testid="toolBar"] > nav';

    function waitForElement(selector)
    {
        return new Promise(resolve => {
            const queryResult = document.querySelector(selector);
            if (queryResult)
            {
                return resolve(queryResult);
            }
            const observer = new MutationObserver(mutations => {
                const queryResult = document.querySelector(selector);
                if (queryResult)
                {
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

// 	function error(...toLog) {
// 		console.error(LOG_PREFIX, ...toLog);
// 	}

// 	function warn(...toLog) {
// 		console.warn(LOG_PREFIX, ...toLog);
// 	}

	function info(...toLog)
    {
		console.info(LOG_PREFIX, ...toLog);
	}

// 	function debug(...toLog) {
// 		console.debug(LOG_PREFIX, ...toLog);
// 	}

    let bsky_handle = GM_getValue('bsky_handle', '');
    let bsky_app_password = GM_getValue('bsky_app_password', '');
    let bsky_crosspost_enabled = bsky_handle != '' && bsky_app_password != '';
    let bsky_crosspost_checked = GM_getValue('bsky_crosspost_checked', false);

    let bsky_settings_div = null;

    /*
	 * Adds new "BSKY" checkbox button to toolbar.
	 */
    function create_button(toolbarDiv)
    {
        const label = document.createElement('label');
        label.className = 'bsky-checkbox';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = bsky_crosspost_checked;
        checkbox.disabled = !bsky_crosspost_enabled;
        checkbox.onclick = async function()
        {
            bsky_crosspost_checked = this.checked;
            GM_setValue('bsky_crosspost_checked', bsky_crosspost_checked);

            for (let el of document.querySelectorAll('.bsky-checkbox input')) {
                el.checked = bsky_crosspost_checked;
            }

            //TMP
            let el = toolbarDiv, dialog;
            while (true)
            {
                el = el.parentNode;
                if (!el)
                {
                    break;
                }
                if (el.getAttribute('role') == 'dialog')
                {
                    info('dialog found');
                    dialog = el;
                    break;
                }
            }

            if (dialog)
            {
                const div_attachments = dialog.querySelector('[data-testid="attachments"]');
                if (div_attachments)
                {
                    for (let img of div_attachments.querySelectorAll('img'))
                    {
                        info(img.src);
                        const reader = new FileReader();
                        reader.onload = function()
                        {
                            info(this.result); // ArrayBuffer { byteLength: 64630 }
                        }
                        const blob = await fetch(img.src).then(r => r.blob());
                        info(blob); // name, size, type
                        reader.readAsArrayBuffer(blob);
                    }
                }
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

        label.appendChild(checkbox);
        //label.appendChild(document.createTextNode('BSKY'));

        const span = document.createElement('span');
        span.innerText = 'BSKY';
        label.appendChild(span);

        toolbarDiv.appendChild(label);
    }

	/*
	 * Main entry point.
	 */
	function main()
    {
        GM_addStyle(`
.bsky-checkbox input {
  cursor: pointer;
}
.bsky-checkbox  span {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-weight: bold;
  cursor: pointer;
}
.bsky-checkbox  input:disabled,
.bsky-checkbox  input:disabled + span {
  color: #ccc;
  cursor: default;
}
.bsky-settings {
  position: fixed;
  width: 200px;
  background: white;
  padding: 10px;
  border: 2px solid #0085FF;
  box-sizing: border-box;
}
.bsky-settings input {
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin-bottom: 10px
}
.bsky-nav {
  width: 1.75rem;
  height: 1.75rem;
  background-image:url(https://bsky.app/static/favicon-32x32.png);
  background-size: contain;
}
        `);

        waitForElement('nav[role="navigation"]').then(navDiv => {
            const a = document.createElement('a');
            a.className = 'bsky-nav';
            //a.href = '#';
            a.title = 'BSKY Settings';
            a.onclick = function(e)
            {
                //info(e);

                if (bsky_settings_div)
                {
                    return;
                }

                bsky_settings_div = document.createElement('div');
                bsky_settings_div.className = 'bsky-settings';
                bsky_settings_div.style = `left:${e.clientX}px;top:${e.clientY}px;`;
                bsky_settings_div.innerHTML = `
                <input type="text" name="bsky_handle" placeholder="BSKY Handle" autocomplete="off" value="${bsky_handle}">
                <input type="password" name="bsky_app_password" placeholder="BSKY App Password" autocomplete="off" value="${bsky_app_password}">
                `
                const btn = document.createElement('button');
                btn.innerText = 'Save';
                bsky_settings_div.appendChild(btn);
                btn.onclick = function(e)
                {
                    bsky_handle = bsky_settings_div.querySelector('[name="bsky_handle"]').value;
                    bsky_app_password = bsky_settings_div.querySelector('[name="bsky_app_password"]').value;

                    document.body.removeChild(bsky_settings_div); //this.parentNode);
                    bsky_settings_div = null;

                    GM_setValue('bsky_handle', bsky_handle);
                    GM_setValue('bsky_app_password', bsky_app_password);

                    bsky_crosspost_enabled = bsky_handle != '' && bsky_app_password != '';

                    // update diabled
                    for (let el of document.querySelectorAll('.bsky-checkbox input'))
                    {
                        el.disabled = !bsky_crosspost_enabled;
                    }
                };

                //info(document.body);
                document.body.appendChild(bsky_settings_div);
                return false;
            };
            navDiv.appendChild(a);
        });

        waitForElement(DIALOG_TOOLBAR_SELECTOR).then(toolbarDiv => {

            //if (!toolbarDiv.querySelector('.bsky-checkbox ')) {
            info('First button added');
            create_button(toolbarDiv);
            //}

			/*
			 * Observer that injects new "BSKY" checkbox button into toolbars of dynamically created popup dialogs
			 */
			const dialogObserver = new MutationObserver(mutations => {

                const toolbarDiv = document.querySelector(DIALOG_TOOLBAR_SELECTOR);
                if (toolbarDiv == null)
                {
                    return;
                }
                if (!toolbarDiv.querySelector('.bsky-checkbox'))
                {
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

    main();

})();
