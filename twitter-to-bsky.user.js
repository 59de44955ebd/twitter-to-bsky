// ==UserScript==
// @name           twitter-to-bsky
// @version        0.5
// @description    Crosspost from Twitter to Bluesky
// @author         59de44955ebd
// @namespace      59de44955ebd
// @license        MIT
// @match          https://twitter.com/*
// @icon           https://raw.githubusercontent.com/59de44955ebd/twitter-to-bsky/main/bsky-32x32.png
// @resource       bsky_icon https://raw.githubusercontent.com/59de44955ebd/twitter-to-bsky/main/bsky-32x32.png
// @grant          GM_getResourceURL
// @grant          GM_setValue
// @grant          GM_getValue
// @grant          GM_addStyle
// @grant          GM_xmlhttpRequest
// @grant          GM_openInTab
// @grant          GM_notification
// @updateURL      https://github.com/59de44955ebd/twitter-to-bsky/raw/main/twitter-to-bsky.meta.js
// @downloadURL    https://github.com/59de44955ebd/twitter-to-bsky/raw/main/twitter-to-bsky.user.js
// @homepageURL    https://github.com/59de44955ebd/twitter-to-bsky
// @supportURL     https://github.com/59de44955ebd/twitter-to-bsky/blob/main/README.md
// @run-at         document-body
// ==/UserScript==

(function() {
    'use strict';

    // config
    const LOG_PREFIX = "[BSKY]";

    const SHOW_NOTIFICATIONS = true;

    const NAV_SELECTOR = 'header nav[role="navigation"]:not(.bsky-navbar)';
    const POST_TOOLBAR_SELECTOR = 'div[data-testid="toolBar"] > nav:not(.bsky-toolbar)';
    const POST_BUTTON_SELECTOR = 'div[data-testid="tweetButton"]:not(.bsky-button), div[data-testid="tweetButtonInline"]:not(.bsky-button)';

    const POST_TEXT_AREA_SELECTOR = '[data-testid="tweetTextarea_0"]';
    const POST_ATTACHMENTS_SELECTOR = '[data-testid="attachments"]';

    const BSKY_PDS_URL = 'https://bsky.social';
    // this size limit specified in the app.bsky.embed.images lexicon
    const BSKY_MAX_UPLOAD_BYTES = 1000000;

    const icon_url = GM_getResourceURL('bsky_icon', false);

    const css = `
.bsky-nav {
  padding: 12px;
  cursor: pointer;
}
.bsky-nav a {
  width: 1.75rem;
  height: 1.75rem;
  background-image: url(${icon_url});
  background-size: cover;
  display: block;
}
.bsky-nav a:after {
  content: "Bluesky";
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 20px;
  margin-left: 46px;
}
@media (max-width: 1264px) {
  .bsky-nav a:after {
    display: none;
  }
}
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
  width: 240px;
  background: white;
  padding: 10px;
  border: 2px solid #0085FF;
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 13.3333px
}
.bsky-settings input[type="text"],
.bsky-settings input[type="password"],
.bsky-settings label
{
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin-bottom: 10px
}
/*
.bsky-button {
  background-color: #000099 !important;
}
*/
`
    let bsky_handle = GM_getValue('bsky_handle', '');
    let bsky_app_password = GM_getValue('bsky_app_password', '');
    let bsky_session = GM_getValue('bsky_session', null);
    let bsky_open_tabs = GM_getValue('bsky_open_tabs', false);

    let bsky_crosspost_enabled = bsky_handle != '' && bsky_app_password != '';
    let bsky_crosspost_checked = GM_getValue('bsky_crosspost_checked', false);

    let bsky_settings_div = null;
    let bsky_client = null;

    let bsky_card = null;
    let is_bsky_posted = false;

    const debug = function(...toLog)
    {
        console.debug(LOG_PREFIX, ...toLog);
    }

    const notify = function(message)
    {
        if (SHOW_NOTIFICATIONS)
        {
            GM_notification(message, 'twitter-to-bsky', icon_url);
        }
    }

    class BSKY
    {
        // all parameters optional
        constructor(bsky_handle, bsky_app_password, bsky_session)
        {
            this._bsky_handle = bsky_handle;
            this._bsky_app_password = bsky_app_password;
            this._session = bsky_session;
        }

        set_credentials(bsky_handle, bsky_app_password)
        {
            this._bsky_handle = bsky_handle;
            this._bsky_app_password = bsky_app_password;
            this._session = null;
        }

        login()
        {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "POST",
                    url: BSKY_PDS_URL + '/xrpc/com.atproto.server.createSession',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    data: JSON.stringify({
                        identifier: this._bsky_handle,
                        password: this._bsky_app_password,
                    }),
                    onload: (response) => {
                        const session = JSON.parse(response.responseText);
                        this._session = session;
                        resolve(session);
                    },
                    onerror: reject,
                });
            });
        }

        refresh_session()
        {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "POST",
                    url: BSKY_PDS_URL + '/xrpc/com.atproto.server.refreshSession',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + this._session.refreshJwt,
                    },
                    onload: (response) => {
                        const session = JSON.parse(response.responseText);
                        this._session = session;
                        resolve(session);
                    },
                    onerror: reject,
                });
            });
        }

        // utility function
        verify_session()
        {
            if (this._session)
            {
                return this.refresh_session()
                    .catch((err) => {
                    return this.login()
                });
            }
            else
            {
                return this.login();
            }
        }

        upload_image(image_object)
        {
            return fetch(image_object.src)
            .then(res => res.blob())
            .then((file_object) => {
                if (file_object.size > BSKY_MAX_UPLOAD_BYTES)
                {
                    throw new Error(`Size of image ${file_object.name} exceeds max. allowed size (${BSKY_MAX_UPLOAD_BYTES})`);
                }
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        GM_xmlhttpRequest({
                            method: "POST",
                            url: BSKY_PDS_URL + '/xrpc/com.atproto.repo.uploadBlob',
                            headers: {
                                'Content-Type': file_object.type,
                                'Authorization': 'Bearer ' + this._session.accessJwt,
                            },
                            data: new Uint8Array(reader.result),
                            onload: (response) => {
                                //debug('upload_image', response.responseText);
                                resolve(JSON.parse(response.responseText));
                            },
                            onerror: reject,
                        });
                    };
                    reader.onerror = reject;
                    reader.readAsArrayBuffer(file_object);
                });
            });
        }

        upload_image_by_url(image_url)
        {
            let image_type;
            return fetch(image_url)
            .then((res) => {
                image_type = res.headers.get('content-type');
                return res.arrayBuffer();
            })
            .then((buf) => {
                if (buf.byteLength > BSKY_MAX_UPLOAD_BYTES)
                {
                    throw new Error(`Size of image ${image_url} exceeds max. allowed size (${BSKY_MAX_UPLOAD_BYTES})`);
                }
                return new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: "POST",
                        url: BSKY_PDS_URL + '/xrpc/com.atproto.repo.uploadBlob',
                        headers: {
                            'Content-Type': image_type,
                            'Authorization': 'Bearer ' + this._session.accessJwt,
                        },
                        data: new Uint8Array(buf),
                        onload: (response) => {
                            resolve(JSON.parse(response.responseText));
                        },
                        onerror: reject,
                    });
                });
            })
        }

        create_post(post_text, post_images, post_embed)
        {
            const now = (new Date()).toISOString();

            // Required fields that each post must include
            const post = {
                '$type': 'app.bsky.feed.post',
                'text': post_text,
                'createdAt': now,
            };

            if (post_images && post_images.images.length)
            {
                post.embed = post_images;
            }

            else if (post_embed)
            {
                post.embed = post_embed;
            }

            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "POST",
                    url: BSKY_PDS_URL + '/xrpc/com.atproto.repo.createRecord',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + this._session.accessJwt,
                    },
                    data: JSON.stringify({
                        repo: this._session.did,
                        collection: 'app.bsky.feed.post',
                        record: post,
                    }),
                    onload: (response) => {
                        resolve(JSON.parse(response.responseText));
                    },
                    onerror: reject,
                });
            });
        }
    }

    /*
     * Adds BSKY icon for changing settings to navbar.
     */
    const extend_navbar = function(nav)
    {
        const a = document.createElement('a');
        a.title = 'Bluesky Settings';
        a.addEventListener('click', function(e)
        {
            if (bsky_settings_div)
            {
                document.body.removeChild(bsky_settings_div);
                bsky_settings_div = null;
                return;
            }

            const r = a.getBoundingClientRect();
            bsky_settings_div = document.createElement('div');
            bsky_settings_div.className = 'bsky-settings';
            bsky_settings_div.style = `left:${r.right + 5}px;top:${r.top}px;`;
            bsky_settings_div.innerHTML = `
                <input type="text" name="bsky_handle" placeholder="Bluesky Handle" autocomplete="off" value="${bsky_handle}">
                <input type="password" name="bsky_app_password" placeholder="Bluesky App Password" autocomplete="off" value="${bsky_app_password}">
                <label><input type="checkbox" name="bsky_open_tabs"${bsky_open_tabs ? ' checked' : ''}>Open Bluesky posts in new tab?</label>
                `
            const btn = document.createElement('button');
            btn.innerText = 'Save';
            bsky_settings_div.appendChild(btn);
            btn.addEventListener('click', function(e) {
                bsky_handle = bsky_settings_div.querySelector('[name="bsky_handle"]').value;
                bsky_app_password = bsky_settings_div.querySelector('[name="bsky_app_password"]').value;
                bsky_open_tabs = bsky_settings_div.querySelector('[name="bsky_open_tabs"]').checked;

                document.body.removeChild(bsky_settings_div);
                bsky_settings_div = null;

                GM_setValue('bsky_handle', bsky_handle);
                GM_setValue('bsky_app_password', bsky_app_password);
                GM_setValue('bsky_open_tabs', bsky_open_tabs);

                bsky_client.set_credentials(bsky_handle, bsky_app_password);
                bsky_crosspost_enabled = bsky_handle != '' && bsky_app_password != '';

                // update disabled state of all checkboxes
                for (let el of document.querySelectorAll('.bsky-checkbox input'))
                {
                    el.disabled = !bsky_crosspost_enabled;
                }
            });

            document.body.appendChild(bsky_settings_div);
            return false;
        });

        const div = document.createElement('div');
        div.className = 'bsky-nav';
        div.appendChild(a);
        nav.appendChild(div);
    }

    /*
     * Adds new BSKY checkbox button to post toolbars.
     */
    const create_bsky_checkbox = function(toolbar)
    {
        const label = document.createElement('label');
        label.className = 'bsky-checkbox';
        label.title = 'Crosspost to Bluesky?';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = bsky_crosspost_checked;
        checkbox.disabled = !bsky_crosspost_enabled;
        checkbox.addEventListener('click', function()
        {
            bsky_crosspost_checked = this.checked;
            GM_setValue('bsky_crosspost_checked', bsky_crosspost_checked);
            for (let el of document.querySelectorAll('.bsky-checkbox input'))
            {
                el.checked = bsky_crosspost_checked;
            }
        });

        label.appendChild(checkbox);

        const span = document.createElement('span');
        span.innerText = 'Bluesky';
        label.appendChild(span);

        toolbar.appendChild(label);
    }

    /*
     * Intercepts post requests, possibly first posts to BSKY, then to Twitter/X.
     */
    const post_button_handler = async function(e) {
        debug('POST BUTTON clicked');
        if (this.firstChild.getAttribute('aria-disabled'))
        {
            e.stopPropagation();
            return;
        }

        if (!is_bsky_posted && bsky_crosspost_enabled && bsky_crosspost_checked)
        {
            // first post to BSKY
            e.stopPropagation();

            let post_text = '';
            let post_images = null;
            let post_card = null;

            try {
                await bsky_client.verify_session()
                .then((session) => {
                    if (session.error)
                    {
                        throw new Error(session.message);
                    }
                    GM_setValue('bsky_session', session);
                });

                const div_text = document.querySelector(POST_TEXT_AREA_SELECTOR);
                if (div_text)
                {
                    post_text = div_text.innerText;
                }

                if (bsky_card && post_text.includes(bsky_card.url))
                {
                    // get card
                    post_card = {
                        '$type': 'app.bsky.embed.external',
                        'external': {
                            uri: bsky_card.url,
                            title: bsky_card.title,
                            description: bsky_card.description,
                        },
                    }
                    if (bsky_card.image)
                    {
                        await bsky_client.upload_image_by_url(bsky_card.image)
                        .then((res) => {
                            post_card.external.thumb = res.blob;
                            post_text = post_text.replace(bsky_card.url, '');
                        });
                    }
                }
                else
                {
                    // get images
                    const div_attachments = document.querySelector(POST_ATTACHMENTS_SELECTOR);
                    if (div_attachments)
                    {
                        const images = div_attachments.querySelectorAll('img');
                        if (images.length)
                        {
                            post_images = {
                                '$type': 'app.bsky.embed.images',
                                'images': [],
                            };
                            for (let img of images)
                            {
                                await bsky_client.upload_image(img)
                                .then((res) => {
                                    post_images.images.push({
                                        alt: '',
                                        image: res.blob
                                    });
                                });
                            }
                        }
                    }
                }

                debug('Posting to BSKY...');
                await bsky_client.create_post(post_text, post_images, post_card)
                .then((res) => {
                    notify('Post was successfully crossposted to Bluesky');
                    if (bsky_open_tabs && res.uri)
                    {
                        GM_openInTab(`https://bsky.app/profile/${bsky_handle}/post/` + res.uri.split('/').pop(), {active: true});
                    }
                });
            }
            catch (error) {
                debug(error);
                notify('Error: crossposting to Bluesky failed');
            }

            is_bsky_posted = true;

            // now forward click event to Twitter/X
            this.click();
        }
        else
        {
            is_bsky_posted = false;
        }
    }

    GM_addStyle(css);

    /*
     * Single-shot observer for the navbar
     */
    const navObserver = new MutationObserver(mutations => {
        const navbar = document.querySelector(NAV_SELECTOR);
        if (navbar)
        {
            navObserver.disconnect();
            debug('NAVBAR found');
            navbar.classList.toggle('bsky-navbar', true);
            extend_navbar(navbar);
        }
    });
    navObserver.observe(document.body, {childList: true, subtree: true});

    /*
     * Observer that watches page for dynamic updates and injects elements and event handlers
     */
    const pageObserver = new MutationObserver(mutations => {

        const toolbar = document.querySelector(POST_TOOLBAR_SELECTOR);
        if (toolbar)
        {
            debug('POST_TOOLBAR found');
            toolbar.classList.toggle('bsky-toolbar', true);
            create_bsky_checkbox(toolbar);
        }

        const button = document.querySelector(POST_BUTTON_SELECTOR);
        if (button)
        {
            debug('POST_BUTTON found');
            button.classList.toggle('bsky-button', true);
            button.addEventListener('click', post_button_handler, true);
        }
    });

    pageObserver.observe(document.body, { childList: true, subtree: true });

    bsky_client = new BSKY(bsky_handle, bsky_app_password, bsky_session);

    // hook into native XMLHttpRequest to capture card data
    unsafeWindow.XMLHttpRequest.prototype._open = unsafeWindow.XMLHttpRequest.prototype.open;
    unsafeWindow.XMLHttpRequest.prototype.open = function(...args) {
        if (args[1].includes('/cards/'))
        {
            this.addEventListener("readystatechange", function() {
                if (this.readyState === 4)
                {
                    const res = JSON.parse(this.response);
                    if (res.card)
                    {
                        debug('CARD found');
                        bsky_card = {
                            url: res.card.url,
                            title: res.card.binding_values.title.string_value,
                            description: res.card.binding_values.description.string_value,
                            image: res.card.binding_values.thumbnail_image_original.image_value.url,
                        };
                    }
                }
            }, false);
        }
        this._open(...args);
    };

})();
