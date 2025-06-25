export async function saveResult (data = {}) {
	return axios({
		method: 'POST',
		url: 'https://clouduntechsg.asuscomm.com:15360' + '/analyze',
		data,
		headers: {
			'Content-Type': 'application/json'
		}
	}).catch((err) => {
		console.log(err)
	})
}