'use strict';

const BSKY_PDS_URL = 'https://bsky.social';

// this size limit specified in the app.bsky.embed.images lexicon
const BSKY_MAX_UPLOAD_BYTES = 1000000;

class BSKY
{

	//######################################
	//
	//######################################
	constructor(bsky_handle, bsky_app_password, session, cors_proxy_url)
	{
		this._bsky_handle = bsky_handle;
		this._bsky_app_password = bsky_app_password;
		this._session = session;
		this._cors_proxy_url = cors_proxy_url;
	}

	//######################################
	// login
	//######################################
	login ()
	{
		return fetch(BSKY_PDS_URL + '/xrpc/com.atproto.server.createSession', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({identifier: this._bsky_handle, password: this._bsky_app_password}),
		})
		.then((res) => res.json())
		.then((session) => {
			this._session = session;
			return session;
		});
	}

	//######################################
	// refresh
	//######################################
	refresh_session ()
	{
		return fetch(BSKY_PDS_URL + '/xrpc/com.atproto.server.refreshSession', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': 'Bearer ' + this._session['refreshJwt'],
			},
		})
		.then((res) => res.json())
		.then((session) => {
			this._session = session;
			return session;
		});
	}

	//######################################
	// createRecord (post)
	// https://atproto.com/blog/create-post
	//######################################
	create_post (post_text, post_images, post_embed)
	{
		const now = (new Date()).toISOString();

		// Required fields that each post must include
		const post = {
		    '$type': 'app.bsky.feed.post',
		    'text': post_text, //'Hello World! (JS)',
		    'createdAt': now,
		};

		if (post_images)
			post['embed'] = post_images

		if (post_embed)
			post['embed'] = post_embed;

		return fetch(BSKY_PDS_URL + '/xrpc/com.atproto.repo.createRecord', {
			method: 'POST',
			headers: {
			  'Content-Type': 'application/json',
			  'Authorization': 'Bearer ' + this._session['accessJwt']
			},
			body: JSON.stringify({
		        repo: this._session['did'],
		        collection: 'app.bsky.feed.post',
		        record: post,
			}),
		})
		.then((res) => res.json());
	}

	//######################################
	// upload_image
	//######################################
	upload_image (file_object)
	{
		return new Promise((resolve, reject) => {
		    const reader = new FileReader();

		    reader.onload = () => {

				//console.log(this.result); // ArrayBuffer { byteLength: 64630 }
		 		const data = new Uint8Array(reader.result);

				fetch(BSKY_PDS_URL + '/xrpc/com.atproto.repo.uploadBlob', {
					method: 'POST',
					headers: {
						'Content-Type': file_object.type,
						'Authorization': 'Bearer ' + this._session['accessJwt']
					},
					body: data,
				})
				.then((res) => res.json())
				.then((res) => resolve(res));
			};

			reader.onerror = reject;
		    reader.readAsArrayBuffer(file_object); //image.files[0]);
		});
	}

	//######################################
	//
	//######################################
	// bsky_fetch_embed_url_card(pds_url: str, access_token: str, url: str) -> Dict
	fetch_embed_url_card (embed_url)
	{
	    // the required fields for an embed card
	    const card = {
	        uri: embed_url,
	        title: '',
	        description: '',
	    };

		return fetch(this._cors_proxy_url + '?u=' + encodeURIComponent(embed_url))
		.then((res) => res.text())
		.then((html) => {
		    var parser = new DOMParser();
		    var doc = parser.parseFromString(html, 'text/html');
		    const meta = {};
			const meta_tags = doc.querySelectorAll('meta');
			[...meta_tags].forEach(function(tag, i) {
			    if (tag.hasAttribute('property')) {
			        const propName = tag.getAttribute('property');
			        // Get the value of the OG property attribute
			        const ogMetaValue = doc.querySelectorAll('meta[property="' + propName +'"]')[0].content;

			        // Add property to ogWebsite object. We can do this because
			        //  ES6 (2015) allows varible keys with object literals.
			        //  To work, you must use bracket "[]" notation instead of dots.
			        meta[propName] = ogMetaValue;
			    }
			});

	//		console.log('1 meta', meta);

		    if (meta['og:title'])
		    	card.title = meta['og:title'];

		    if (meta['og:description'])
		    	card.description = meta['og:description'];

		    if (meta['og:image'])
		    {
		    	let img_url = meta['og:image'];

		        if (!img_url.includes('://'))
		            img_url = embed_url + img_url

				return fetch(this._cors_proxy_url + '?t=application/octet-stream&u=' + encodeURIComponent(img_url))
				.then((res) => res.arrayBuffer())
				.then((res) => {
	//				console.log('2 image_data', res);
					return fetch(BSKY_PDS_URL + '/xrpc/com.atproto.repo.uploadBlob', {
						method: 'POST',
						headers: {
							'Content-Type': 'image/jpeg', //file_object.type,
							'Authorization': 'Bearer ' + this._session['accessJwt']
						},
						body: new Uint8Array(res),
					});
				})
				.then((res) => res.json())
				.then((res) => {
	//				console.log('3 uploadBlob', res)
	//				{
	//				  'blob': {
	//				    '$type': 'blob',
	//				    'ref': {
	//				      '$link': 'bafkreifbqfn7t2dyhatka4nbk327qme2qmublioostu6q6sxc2yohwwdyq'
	//				    },
	//				    'mimeType': 'image/jpeg',
	//				    'size': 87076
	//				  }
	//				}

					card['thumb'] = res.blob;
				    return {
				        '$type': 'app.bsky.embed.external',
				        'external': card,
				    };
				});
			}
			else
			    return {
			        '$type': 'app.bsky.embed.external',
			        'external': card,
			    };
		})
		.catch((err) => console.log('Failed to fetch page: ', err));
	}

	//######################################
	// utility
	//######################################
	verify_session ()
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
}
