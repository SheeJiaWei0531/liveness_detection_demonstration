export async function saveResult (data = {}) {
	return axios({
		method: 'POST',
		url: 'http://192.168.50.201:15360' + '/analyze',
		data,
		headers: {
			'Content-Type': 'application/json'
		}
	}).catch((err) => {
		console.log(err)
	})
}