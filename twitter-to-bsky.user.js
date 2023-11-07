// ==UserScript==
// @name           twitter-to-bsky
// @version        0.11
// @description    Crosspost from Twitter/X to Bluesky and Mastodon
// @author         59de44955ebd
// @license        MIT
// @namespace      59de44955ebd
// @match          https://twitter.com/*
// @icon           https://raw.githubusercontent.com/59de44955ebd/twitter-to-bsky/main/cross-64x64.png
// @resource       cross_icon https://raw.githubusercontent.com/59de44955ebd/twitter-to-bsky/main/cross-64x64.png
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
// @inject-into    page
// ==/UserScript==

/*jshint esversion: 8 */

(function() {
    'use strict';

    // Config
    const NAV_SELECTOR = 'header nav[role="navigation"]:not(.bsky-navbar)';
    const POST_TOOLBAR_SELECTOR = 'div[data-testid="toolBar"] > nav:not(.bsky-toolbar)';
    const POST_BUTTON_SELECTOR = 'div[data-testid="tweetButton"]:not(.bsky-button), div[data-testid="tweetButtonInline"]:not(.bsky-button)';

    const POST_TEXT_AREA_SELECTOR = '[data-testid="tweetTextarea_0"]';
    const POST_ATTACHMENTS_SELECTOR = '[data-testid="attachments"]';

    const BSKY_PDS_URL = 'https://bsky.social';

    const BSKY_IMAGE_MAX_BYTES = 1000000; // 10 MB

    const MASTODON_IMAGE_MAX_BYTES = 8000000; // 8 MB
    const MASTODON_VIDEO_MAX_BYTES = 40000000; // 40 MB

    const icon_url = GM_getResourceURL('cross_icon', false);

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
@media (min-width: 1265px) {
  .bsky-nav a:after {
    content: "Crosspost";
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 20px;
    font-weight: 400;
    margin-left: 46px;
    color: rgb(15, 20, 25);
  }
}
@media (prefers-color-scheme: dark) {
  .bsky-nav a {
    filter: invert(1);
  }
  .bsky-nav a:after {
    font-weight: 500;
  }
}
.cross-checkbox {
  margin-left: 5px;
}
.cross-checkbox input {
  cursor: pointer;
}
.cross-checkbox span {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-weight: bold;
  font-size: 11px;
  cursor: pointer;
}
.cross-checkbox  input:disabled,
.cross-checkbox  input:disabled + span {
  color: #ccc;
  cursor: default;
}
.bsky-settings {
  position: fixed;
  width: 280px;
  background: inherit;
  padding: 10px;
  border: 2px solid #0085FF;
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 13.3333px
}
.bsky-settings fieldset {
  margin-bottom: 5px;
  padding-bottom: 2px;
}
.bsky-settings legend {
  font-size: 11px;
  font-weight: bold;
  margin-bottom: 5px;
}
.bsky-settings input[type="text"],
.bsky-settings input[type="url"],
.bsky-settings input[type="password"]
{
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin-bottom: 10px
}
.bsky-settings label {
    display: block;
    cursor: pointer;
}
.bsky-settings button {
    margin-top: 10px
}
`;
    // Mastodon stuff
    let mastodon_client = null;
    let mastodon_instance_url = GM_getValue('mastodon_instance_url', 'https://mastodon.social');
    let mastodon_api_key = GM_getValue('mastodon_api_key', '');
    let mastodon_crosspost_enabled = mastodon_instance_url != '' && mastodon_api_key != '';
    let mastodon_crosspost_checked = GM_getValue('mastodon_crosspost_checked', false);

    // Bluesky stuff
    let bsky_client = null;
    let bsky_handle = GM_getValue('bsky_handle', '');
    let bsky_app_password = GM_getValue('bsky_app_password', '');
    let bsky_session = GM_getValue('bsky_session', null);
    let bsky_crosspost_enabled = bsky_handle != '' && bsky_app_password != '';
    let bsky_crosspost_checked = GM_getValue('bsky_crosspost_checked', false);

    let crosspost_show_notifications = GM_getValue('crosspost_show_notifications', true);
    let crosspost_open_tabs = GM_getValue('crosspost_open_tabs', false);

    let settings_div = null;
    let media_card = null;
    let is_cross_posted = false;

    const debug = function(...toLog)
    {
        console.debug('[BSKY]', ...toLog);
    };

    const notify = function(message)
    {
        if (crosspost_show_notifications)
        {
            GM_notification(message, 'twitter-to-bsky', icon_url);
        }
    };

    class Mastodon
    {
        // Parameters are optional
        constructor(mastodon_api_root_url, mastodon_api_key)
        {
            this._mastodon_api_root_url = mastodon_api_root_url;
            this._mastodon_api_key = mastodon_api_key;
        }

        set_credentials(mastodon_api_root_url, mastodon_api_key)
        {
            this._mastodon_api_root_url = mastodon_api_root_url;
            this._mastodon_api_key = mastodon_api_key;
        }

        async upload_image(image_url)
        {
            return fetch(image_url)
            .then(res => res.blob())
            .then(blob => {
                if (blob.size > MASTODON_IMAGE_MAX_BYTES)
                {
                    throw new Error(`Size of image ${blob.name} exceeds max. allowed size (${MASTODON_IMAGE_MAX_BYTES})`);
                }
                const formData = new FormData();
                formData.append('file', blob);
                return new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'POST',
                        url: this._mastodon_api_root_url + '/api/v1/media',
                        headers: {
                            'Authorization': 'Bearer ' + this._mastodon_api_key,
                        },
                        fetch: true,
                        data: formData,
                        onload: (response) => {
                            const res = JSON.parse(response.responseText);
                            if (res.error)
                            {
                                reject(res.error);
                            }
                            resolve(res);
                        },
                        onerror: reject,
                    });
                });
            });
        }

        async upload_video(video_object)
        {
            return fetch(video_object.currentSrc)
            .then(res => res.blob())
            .then(blob => {
                if (blob.size > MASTODON_VIDEO_MAX_BYTES)
                {
                    throw new Error(`Size of video ${blob.name} exceeds max. allowed size (${MASTODON_VIDEO_MAX_BYTES})`);
                }
                const formData = new FormData();
                formData.append('file', blob);
                return new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'POST',
                        url: this._mastodon_api_root_url + '/api/v1/media',
                        headers: {
                            'Authorization': 'Bearer ' + this._mastodon_api_key,
                        },
                        fetch: true,
                        data: formData,
                        onload: (response) => {
                            const res = JSON.parse(response.responseText);
                            if (res.error)
                            {
                                reject(res.error);
                            }
                            resolve(res);
                        },
                        onerror: reject,
                    });
                });
            });
        }

        async create_post(post_text, media_ids)
        {
            const post = {
                status: post_text,
            };

            if (media_ids && media_ids.length)
            {
                post.media_ids = media_ids;
            }

            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "POST",
                    url: this._mastodon_api_root_url + '/api/v1/statuses',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + this._mastodon_api_key,
                    },
                    fetch: true,
                    data: JSON.stringify(post),
                    onload: (response) => {
                        const res = JSON.parse(response.responseText);
                        if (res.error)
                        {
                            reject(res.error);
                        }
                        resolve(res);
                    },
                    onerror: reject,
                });
            });
        }
    }

    class BSKY
    {
        // All parameters are optional
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

        async login()
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
                        if (session.error)
                        {
                            reject(session.message);
                        }
                        this._session = session;
                        resolve(session);
                    },
                    onerror: reject,
                });
            });
        }

        async refresh_session()
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
                        if (session.error)
                        {
                            reject(session.message);
                        }
                        this._session = session;
                        resolve(session);
                    },
                    onerror: reject,
                });
            });
        }

        // Utility function
        async verify_session()
        {
            if (this._session)
            {
                try
                {
                    return await this.refresh_session();
                } catch (err)
                {
                    return await this.login();
                }
            }
            else
            {
                return this.login();
            }
        }

        async upload_image(image_url)
        {
            return fetch(image_url)
            .then(res => res.blob())
            .then(blob => {
                if (blob.size > BSKY_IMAGE_MAX_BYTES)
                {
                    throw new Error(`Size of image ${blob.name} exceeds max. allowed size (${BSKY_IMAGE_MAX_BYTES})`);
                }
                return new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: "POST",
                        url: BSKY_PDS_URL + '/xrpc/com.atproto.repo.uploadBlob',
                        headers: {
                            'Content-Type': blob.type,
                            'Authorization': 'Bearer ' + this._session.accessJwt,
                        },
                        fetch: true,
                        data: blob,
                        onload: (response) => {
                            const res = JSON.parse(response.responseText);
                            if (res.error)
                            {
                                reject(res.message);
                            }
                            resolve(res);
                        },
                        onerror: reject,
                    });
                });
            });
        }

        async create_post(post_text, post_images, post_embed)
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
                    fetch: true,
                    data: JSON.stringify({
                        repo: this._session.did,
                        collection: 'app.bsky.feed.post',
                        record: post,
                    }),
                    onload: (response) => {
                        const res = JSON.parse(response.responseText);
                        if (res.error)
                        {
                            reject(res.message);
                        }
                        resolve(res);
                    },
                    onerror: reject,
                });
            });
        }
    }

    /*
     * Adds new cross icon to navbar for changing crosspost settings.
     */
    const extend_navbar = function(nav)
    {
        const a = document.createElement('a');
        a.title = 'Crosspost Settings';
        a.addEventListener('click', function()
        {
            if (settings_div)
            {
                document.body.removeChild(settings_div);
                settings_div = null;
                return;
            }

            const r = a.getBoundingClientRect();
            settings_div = document.createElement('div');
            settings_div.className = 'bsky-settings';
            settings_div.style = `left:${r.right + 5}px;top:${r.top}px;`;
            settings_div.innerHTML = `
                <fieldset>
                    <legend>Mastodon</legend>
                    <input type="url" name="mastodon_instance_url" placeholder="Mastodon Instance URL" autocomplete="section-mastodon url" value="${mastodon_instance_url}">
                    <input type="password" name="mastodon_api_key" placeholder="Mastodon Access Token" autocomplete="section-mastodon current-password" value="${mastodon_api_key}">
                </fieldset>
                <fieldset>
                    <legend>Bluesky</legend>
                    <input type="text" name="bsky_handle" placeholder="Bluesky Handle" autocomplete="section-bsky username" value="${bsky_handle}">
                    <input type="password" name="bsky_app_password" placeholder="Bluesky App Password" autocomplete="section-bsky current-password" value="${bsky_app_password}">
                </fieldset>
                <label><input type="checkbox" name="crosspost_show_notifications"${crosspost_show_notifications ? ' checked' : ''}>Show crosspost notifications?</label>
                <label><input type="checkbox" name="crosspost_open_tabs"${crosspost_open_tabs ? ' checked' : ''}>Open crossposts in new tab?</label>
                `;
            const btn = document.createElement('button');
            btn.innerText = 'Save';
            settings_div.appendChild(btn);
            btn.addEventListener('click', function() {

                mastodon_instance_url = settings_div.querySelector('[name="mastodon_instance_url"]').value;
                mastodon_api_key = settings_div.querySelector('[name="mastodon_api_key"]').value;

                bsky_handle = settings_div.querySelector('[name="bsky_handle"]').value;
                bsky_app_password = settings_div.querySelector('[name="bsky_app_password"]').value;

                crosspost_show_notifications = settings_div.querySelector('[name="crosspost_show_notifications"]').checked;
                crosspost_open_tabs = settings_div.querySelector('[name="crosspost_open_tabs"]').checked;

                document.body.removeChild(settings_div);
                settings_div = null;

                GM_setValue('mastodon_instance_url', mastodon_instance_url);
                GM_setValue('mastodon_api_key', mastodon_api_key);

                GM_setValue('bsky_handle', bsky_handle);
                GM_setValue('bsky_app_password', bsky_app_password);

                GM_setValue('crosspost_show_notifications', crosspost_show_notifications);
                GM_setValue('crosspost_open_tabs', crosspost_open_tabs);

                mastodon_client.set_credentials(mastodon_instance_url, mastodon_api_key);
                mastodon_crosspost_enabled = mastodon_instance_url != '' && mastodon_api_key != '';

                // Update disabled state of all checkboxes
                for (let el of document.querySelectorAll('.mastodon-checkbox input'))
                {
                    el.disabled = !mastodon_crosspost_enabled;
                }

                bsky_client.set_credentials(bsky_handle, bsky_app_password);
                bsky_crosspost_enabled = bsky_handle != '' && bsky_app_password != '';

                // Update disabled state of all checkboxes
                for (let el of document.querySelectorAll('.bsky-checkbox input'))
                {
                    el.disabled = !bsky_crosspost_enabled;
                }
            });

            document.body.appendChild(settings_div);
            return false;
        });

        const div = document.createElement('div');
        div.className = 'bsky-nav';
        div.appendChild(a);
        nav.appendChild(div);
    };

    /*
     * Adds new Bluesky and Mastodon checkboxes to post toolbars
     */
    const create_crosspost_checkboxes = function(toolbar)
    {
        const label_m = document.createElement('label');
        label_m.className = 'cross-checkbox mastodon-checkbox';
        label_m.title = 'Crosspost to Mastodon?';
        const checkbox_m = document.createElement('input');
        checkbox_m.type = 'checkbox';
        checkbox_m.checked = mastodon_crosspost_checked;
        checkbox_m.disabled = !mastodon_crosspost_enabled;
        checkbox_m.addEventListener('click', function()
        {
            mastodon_crosspost_checked = this.checked;
            GM_setValue('mastodon_crosspost_checked', mastodon_crosspost_checked);
            for (let el of document.querySelectorAll('.mastodon-checkbox input'))
            {
                el.checked = mastodon_crosspost_checked;
            }
        });
        label_m.appendChild(checkbox_m);
        const span_m = document.createElement('span');
        span_m.innerText = 'Mastodon';
        label_m.appendChild(span_m);
        toolbar.appendChild(label_m);

        const label_b = document.createElement('label');
        label_b.className = 'cross-checkbox bsky-checkbox';
        label_b.title = 'Crosspost to Bluesky?';
        const checkbox_b = document.createElement('input');
        checkbox_b.type = 'checkbox';
        checkbox_b.checked = bsky_crosspost_checked;
        checkbox_b.disabled = !bsky_crosspost_enabled;
        checkbox_b.addEventListener('click', function()
        {
            bsky_crosspost_checked = this.checked;
            GM_setValue('bsky_crosspost_checked', bsky_crosspost_checked);
            for (let el of document.querySelectorAll('.bsky-checkbox input'))
            {
                el.checked = bsky_crosspost_checked;
            }
        });
        label_b.appendChild(checkbox_b);
        const span_b = document.createElement('span');
        span_b.innerText = 'Bluesky';
        label_b.appendChild(span_b);
        toolbar.appendChild(label_b);
    };

    /*
     * Intercepts post requests, possibly first posts to Mastodon and/or Bluesky, then to Twitter/X.
     */
    const post_button_handler = async function(e)
    {
        debug('POST BUTTON clicked');
        if (this.firstChild.getAttribute('aria-disabled'))
        {
            e.stopPropagation();
            return;
        }

        if (!is_cross_posted && ((mastodon_crosspost_enabled && mastodon_crosspost_checked) || (bsky_crosspost_enabled && bsky_crosspost_checked)))
        {
            // First crosspost
            e.stopPropagation();

            let post_text = '';

            const div_text = document.querySelector(POST_TEXT_AREA_SELECTOR);
            if (div_text)
            {
                post_text = div_text.innerText;
            }

            // Mastodon
            if (mastodon_crosspost_enabled && mastodon_crosspost_checked)
            {
                try
                {
                    // Get media attachments
                    const media_ids = [];
                    const div_attachments = document.querySelector(POST_ATTACHMENTS_SELECTOR);
                    if (div_attachments)
                    {
                        const images = div_attachments.querySelectorAll('img');
                        if (images.length)
                        {
                            for (let img of images)
                            {
                                await mastodon_client.upload_image(img.src)
                                .then((res) => {
                                    media_ids.push(res.id);
                                });
                            }
                        }
                        const videos = div_attachments.querySelectorAll('video');
                        if (videos.length)
                        {
                            for (let vid of videos)
                            {
                                await mastodon_client.upload_video(vid)
                                .then((res) => {
                                    media_ids.push(res.id);
                                });
                            }
                        }
                    }

                    debug('Posting to Mastodon...');
                    await mastodon_client.create_post(post_text, media_ids)
                    .then((res) => {
                        notify('Post was successfully crossposted to Mastodon');
                        if (crosspost_open_tabs && res.uri)
                        {
                            GM_openInTab(res.url, {active: true});
                        }
                    });
                }
                catch (error)
                {
                    debug(error);
                    notify(`Error: crossposting to Mastodon failed: \n${error}`);
                }
            }

            // Bluesky
            if (bsky_crosspost_enabled && bsky_crosspost_checked)
            {
                const post_images = {
                    '$type': 'app.bsky.embed.images',
                    'images': [],
                };
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

                    // Get images
                    const div_attachments = document.querySelector(POST_ATTACHMENTS_SELECTOR);
                    if (div_attachments)
                    {
                        for (let img of div_attachments.querySelectorAll('img'))
                        {
                            await bsky_client.upload_image(img.src)
                            .then((res) => {
                                post_images.images.push({
                                    alt: '',
                                    image: res.blob
                                });
                            });
                        }
                    }

                    // Get card (Bluesky only allows either images or card)
                    if (!post_images.images.length && media_card && post_text.includes(media_card.url))
                    {
                        post_card = {
                            '$type': 'app.bsky.embed.external',
                            'external': {
                                uri: media_card.url,
                                title: media_card.title,
                                description: media_card.description,
                            },
                        };
                        if (media_card.image)
                        {
                            await bsky_client.upload_image(media_card.image)
                            .then((res) => {
                                post_card.external.thumb = res.blob;
                                // post_text = post_text.replace(media_card.url, '');
                            });
                        }
                    }

                    debug('Posting to Bluesky...');
                    await bsky_client.create_post(post_text, post_images, post_card)
                    .then((res) => {
                        notify('Post was successfully crossposted to Bluesky');
                        if (crosspost_open_tabs && res.uri)
                        {
                            GM_openInTab(`https://bsky.app/profile/${bsky_handle}/post/` + res.uri.split('/').pop(), {active: true});
                        }
                    });
                }
                catch (error)
                {
                    debug(error);
                    notify(`Error: crossposting to Bluesky failed: \n${error.message}`);
                }
            }

            is_cross_posted = true;

            // Now forward click event to actually post on Twitter/X
            this.click();
        }
        else
        {
            is_cross_posted = false;
        }
    };

    GM_addStyle(css);

    /*
     * Observer that watches page for dynamic updates and injects elements and event handlers
     */
    const pageObserver = new MutationObserver(() => {

        const navbar = document.querySelector(NAV_SELECTOR);
        if (navbar && !navbar.querySelector('.bsky-nav'))
        {
            debug('NAVBAR found');
            navbar.classList.toggle('bsky-navbar', true);
            extend_navbar(navbar);
        }

        const toolbar = document.querySelector(POST_TOOLBAR_SELECTOR);
        if (toolbar)
        {
            debug('POST_TOOLBAR found');
            toolbar.classList.toggle('bsky-toolbar', true);
            create_crosspost_checkboxes(toolbar);
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

    mastodon_client = new Mastodon(mastodon_instance_url, mastodon_api_key);
    bsky_client = new BSKY(bsky_handle, bsky_app_password, bsky_session);

    // Hook into native XMLHttpRequest to capture card data
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
                        media_card = {
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
