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


export async function ClickSave (data = {}) {
	return axios({
		method: 'POST',
		url: 'https://homenas226b803d.synology.me:13420' + '/click',
		data,
		headers: {
			'Content-Type': 'application/json'
		}
	}).catch((err) => {
		console.log(err)
	})
}

export function idWithRand(date = new Date()) {
	const y = date.getFullYear();
	const M = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	const h = String(date.getHours()).padStart(2, '0');
	const m = String(date.getMinutes()).padStart(2, '0');
	const s = String(date.getSeconds()).padStart(2, '0');
	const r = String(Math.floor(Math.random() * 100) + 1).padStart(3, '0'); // 001–100
	return `${y}${M}${d}${h}${m}${s}${r}`;
  }