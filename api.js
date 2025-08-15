export async function saveResult (data = {}) {
	return axios({
		method: 'POST',
		url: 'https://homenas226b803d.synology.me:13420' + '/analyze',
		data,
		headers: {
			'Content-Type': 'application/json'
		}
	}).catch((err) => {
		console.log(err)
	})
}