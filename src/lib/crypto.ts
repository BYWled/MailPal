/**
 * Web Crypto-based authentication, password hashing (PBKDF2),
 * and TOTP (RFC 6238 / RFC 4226) implementation for Cloudflare Workers & SvelteKit.
 */

// ─── PBKDF2 Password Hashing ─────────────────────────────────────────────────

const PBKDF2_ITERATIONS = 100_000;

function bufferToHex(buffer: ArrayBuffer | Uint8Array): string {
	const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

function hexToBuffer(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
	}
	return bytes;
}

export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const enc = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		enc.encode(password) as unknown as BufferSource,
		{ name: 'PBKDF2' },
		false,
		['deriveBits']
	);

	const derivedBits = await crypto.subtle.deriveBits(
		{
			name: 'PBKDF2',
			salt: salt as unknown as BufferSource,
			iterations: PBKDF2_ITERATIONS,
			hash: 'SHA-256'
		},
		keyMaterial,
		256
	);

	const saltHex = bufferToHex(salt);
	const hashHex = bufferToHex(derivedBits);
	return `pbkdf2$${PBKDF2_ITERATIONS}$${saltHex}$${hashHex}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
	try {
		const parts = storedHash.split('$');
		if (parts.length !== 4 || parts[0] !== 'pbkdf2') {
			return false;
		}
		const iterations = parseInt(parts[1], 10);
		const salt = hexToBuffer(parts[2]);
		const expectedHashHex = parts[3];

		const enc = new TextEncoder();
		const keyMaterial = await crypto.subtle.importKey(
			'raw',
			enc.encode(password) as unknown as BufferSource,
			{ name: 'PBKDF2' },
			false,
			['deriveBits']
		);

		const derivedBits = await crypto.subtle.deriveBits(
			{
				name: 'PBKDF2',
				salt: salt as unknown as BufferSource,
				iterations,
				hash: 'SHA-256'
			},
			keyMaterial,
			256
		);

		const actualHashHex = bufferToHex(derivedBits);
		if (actualHashHex.length !== expectedHashHex.length) return false;

		// Constant-time comparison
		let diff = 0;
		for (let i = 0; i < actualHashHex.length; i++) {
			diff |= actualHashHex.charCodeAt(i) ^ expectedHashHex.charCodeAt(i);
		}
		return diff === 0;
	} catch {
		return false;
	}
}

// ─── Base32 Encoding / Decoding (RFC 4648) ───────────────────────────────────

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Uint8Array): string {
	let bits = 0;
	let value = 0;
	let output = '';

	for (let i = 0; i < buffer.length; i++) {
		value = (value << 8) | buffer[i];
		bits += 8;
		while (bits >= 5) {
			output += BASE32_CHARS[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}

	if (bits > 0) {
		output += BASE32_CHARS[(value << (5 - bits)) & 31];
	}

	return output;
}

export function base32Decode(input: string): Uint8Array {
	const cleaned = input.toUpperCase().replace(/=+$/, '').replace(/[\s-]/g, '');
	let bits = 0;
	let value = 0;
	const bytes: number[] = [];

	for (let i = 0; i < cleaned.length; i++) {
		const idx = BASE32_CHARS.indexOf(cleaned[i]);
		if (idx === -1) continue; // skip invalid characters
		value = (value << 5) | idx;
		bits += 5;
		if (bits >= 8) {
			bytes.push((value >>> (bits - 8)) & 255);
			bits -= 8;
		}
	}

	return new Uint8Array(bytes);
}

// ─── RFC 6238 / RFC 4226 TOTP Implementation ────────────────────────────────

export function generateTotpSecret(length = 20): string {
	const buffer = crypto.getRandomValues(new Uint8Array(length));
	return base32Encode(buffer);
}

export async function generateTotp(secretBase32: string, counter: number): Promise<string> {
	const keyData = base32Decode(secretBase32);
	const key = await crypto.subtle.importKey(
		'raw',
		keyData as unknown as BufferSource,
		{ name: 'HMAC', hash: 'SHA-1' },
		false,
		['sign']
	);

	// Counter as 8-byte big-endian buffer
	const counterBuffer = new Uint8Array(8);
	let temp = counter;
	for (let i = 7; i >= 0; i--) {
		counterBuffer[i] = temp & 0xff;
		temp = Math.floor(temp / 256);
	}

	const signature = await crypto.subtle.sign('HMAC', key, counterBuffer as unknown as BufferSource);
	const sigBytes = new Uint8Array(signature);

	// Dynamic truncation according to RFC 4226
	const offset = sigBytes[sigBytes.length - 1] & 0x0f;
	const code =
		((sigBytes[offset] & 0x7f) << 24) |
		((sigBytes[offset + 1] & 0xff) << 16) |
		((sigBytes[offset + 2] & 0xff) << 8) |
		(sigBytes[offset + 3] & 0xff);

	const otp = (code % 1_000_000).toString().padStart(6, '0');
	return otp;
}

export async function verifyTotp(
	token: string,
	secretBase32: string,
	window = 1
): Promise<boolean> {
	if (!token || token.trim().length !== 6) return false;
	const trimmed = token.trim();
	const currentStep = Math.floor(Date.now() / 1000 / 30);

	for (let i = -window; i <= window; i++) {
		const expected = await generateTotp(secretBase32, currentStep + i);
		if (expected === trimmed) {
			return true;
		}
	}
	return false;
}

export function generateTotpUri(username: string, secretBase32: string, issuer = 'MailPal'): string {
	return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(username)}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// ─── Pure SVG QR Code Generator (Zero External Dependencies) ──────────────────

/**
 * QR Code Generator supporting Byte mode with Error Correction Level M.
 * Dynamically selects QR Version (1-10) based on input length.
 */

// Galois Field GF(256) tables for QR Reed-Solomon coding
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGF() {
	let x = 1;
	for (let i = 0; i < 255; i++) {
		GF_EXP[i] = x;
		GF_LOG[x] = i;
		x = (x << 1) ^ (x >= 128 ? 0x11d : 0);
	}
	for (let i = 255; i < 512; i++) {
		GF_EXP[i] = GF_EXP[i - 255];
	}
})();

function gfMul(x: number, y: number): number {
	if (x === 0 || y === 0) return 0;
	return GF_EXP[GF_LOG[x] + GF_LOG[y]];
}

function rsGeneratorPoly(degree: number): Uint8Array {
	let poly = new Uint8Array([1]);
	for (let i = 0; i < degree; i++) {
		const next = new Uint8Array(poly.length + 1);
		for (let j = 0; j < poly.length; j++) {
			next[j] ^= gfMul(poly[j], GF_EXP[i]);
			next[j + 1] ^= poly[j];
		}
		poly = next;
	}
	return poly;
}

function rsCompute(data: Uint8Array, ecCount: number): Uint8Array {
	const gen = rsGeneratorPoly(ecCount);
	const res = new Uint8Array(data.length + ecCount);
	res.set(data);
	for (let i = 0; i < data.length; i++) {
		const coef = res[i];
		if (coef !== 0) {
			for (let j = 0; j < gen.length; j++) {
				res[i + j] ^= gfMul(gen[j], coef);
			}
		}
	}
	return res.slice(data.length);
}

// QR Version table: [version, capacityBytes_M, ecCodewords, blocks, size]
const QR_VERSIONS: Array<{ version: number; dataBytes: number; ecBytes: number; blocks: number; size: number }> = [
	{ version: 1, dataBytes: 14, ecBytes: 10, blocks: 1, size: 21 },
	{ version: 2, dataBytes: 26, ecBytes: 16, blocks: 1, size: 25 },
	{ version: 3, dataBytes: 42, ecBytes: 26, blocks: 1, size: 29 },
	{ version: 4, dataBytes: 62, ecBytes: 18, blocks: 2, size: 33 },
	{ version: 5, dataBytes: 84, ecBytes: 24, blocks: 2, size: 37 },
	{ version: 6, dataBytes: 106, ecBytes: 16, blocks: 4, size: 41 },
	{ version: 7, dataBytes: 122, ecBytes: 18, blocks: 4, size: 45 },
	{ version: 8, dataBytes: 152, ecBytes: 22, blocks: 4, size: 49 },
	{ version: 9, dataBytes: 180, ecBytes: 22, blocks: 5, size: 53 },
	{ version: 10, dataBytes: 213, ecBytes: 26, blocks: 5, size: 57 }
];

const ALIGNMENT_PATTERNS: Record<number, number[]> = {
	2: [6, 18],
	3: [6, 22],
	4: [6, 26],
	5: [6, 30],
	6: [6, 34],
	7: [6, 22, 38],
	8: [6, 24, 42],
	9: [6, 26, 46],
	10: [6, 28, 50]
};

export function generateQrCodeSvg(text: string, size = 220): string {
	const enc = new TextEncoder();
	const rawData = enc.encode(text);

	// Find minimum fitting QR version
	let verInfo = QR_VERSIONS.find((v) => v.dataBytes >= rawData.length + 3);
	if (!verInfo) {
		verInfo = QR_VERSIONS[QR_VERSIONS.length - 1];
	}

	const { version, dataBytes, ecBytes, blocks, size: modules } = verInfo;

	// Encode bitstream: Mode (0100 = 8-bit byte), Count (8 bits for v1-9, 16 bits for v10+), data
	const bits: number[] = [];
	function pushBits(val: number, len: number) {
		for (let i = len - 1; i >= 0; i--) {
			bits.push((val >>> i) & 1);
		}
	}

	pushBits(0b0100, 4); // Byte mode
	pushBits(rawData.length, version < 10 ? 8 : 16);
	for (const b of rawData) {
		pushBits(b, 8);
	}

	// Terminator bits (up to 4)
	const maxDataBits = dataBytes * 8;
	const termLen = Math.min(4, maxDataBits - bits.length);
	for (let i = 0; i < termLen; i++) bits.push(0);

	// Byte align
	while (bits.length % 8 !== 0) bits.push(0);

	// Pad bytes
	const PAD = [0xec, 0x11];
	let padIdx = 0;
	while (bits.length < maxDataBits) {
		pushBits(PAD[padIdx % 2], 8);
		padIdx++;
	}

	// Convert bits to byte array
	const dataCodewords = new Uint8Array(dataBytes);
	for (let i = 0; i < dataBytes; i++) {
		let byteVal = 0;
		for (let b = 0; b < 8; b++) {
			byteVal = (byteVal << 1) | bits[i * 8 + b];
		}
		dataCodewords[i] = byteVal;
	}

	// Block interleaving & error correction
	const blockSize = Math.floor(dataBytes / blocks);
	const dataBlocks: Uint8Array[] = [];
	const ecBlocks: Uint8Array[] = [];

	let offset = 0;
	for (let b = 0; b < blocks; b++) {
		const curSize = b < dataBytes % blocks ? blockSize + 1 : blockSize;
		const slice = dataCodewords.slice(offset, offset + curSize);
		dataBlocks.push(slice);
		ecBlocks.push(rsCompute(slice, ecBytes));
		offset += curSize;
	}

	// Interleave data and EC codewords
	const finalCodewords: number[] = [];
	const maxBlockLen = Math.max(...dataBlocks.map((b) => b.length));
	for (let i = 0; i < maxBlockLen; i++) {
		for (let b = 0; b < blocks; b++) {
			if (i < dataBlocks[b].length) finalCodewords.push(dataBlocks[b][i]);
		}
	}
	for (let i = 0; i < ecBytes; i++) {
		for (let b = 0; b < blocks; b++) {
			finalCodewords.push(ecBlocks[b][i]);
		}
	}

	// Create grid: matrix[r][c], reserved[r][c]
	const matrix: boolean[][] = Array.from({ length: modules }, () => Array(modules).fill(false));
	const reserved: boolean[][] = Array.from({ length: modules }, () => Array(modules).fill(false));

	function setFinder(r: number, c: number) {
		for (let i = -1; i <= 7; i++) {
			for (let j = -1; j <= 7; j++) {
				const row = r + i;
				const col = c + j;
				if (row >= 0 && row < modules && col >= 0 && col < modules) {
					reserved[row][col] = true;
					const isBlack =
						(i >= 0 && i <= 6 && (j === 0 || j === 6)) ||
						(j >= 0 && j <= 6 && (i === 0 || i === 6)) ||
						(i >= 2 && i <= 4 && j >= 2 && j <= 4);
					matrix[row][col] = isBlack;
				}
			}
		}
	}

	// 3 Finder patterns
	setFinder(0, 0);
	setFinder(0, modules - 7);
	setFinder(modules - 7, 0);

	// Timing patterns
	for (let i = 8; i < modules - 8; i++) {
		reserved[6][i] = true;
		matrix[6][i] = i % 2 === 0;
		reserved[i][6] = true;
		matrix[i][6] = i % 2 === 0;
	}

	// Dark module
	reserved[4 * version + 9][8] = true;
	matrix[4 * version + 9][8] = true;

	// Alignment patterns
	if (ALIGNMENT_PATTERNS[version]) {
		const pos = ALIGNMENT_PATTERNS[version];
		for (const r of pos) {
			for (const c of pos) {
				if (reserved[r][c]) continue;
				for (let i = -2; i <= 2; i++) {
					for (let j = -2; j <= 2; j++) {
						reserved[r + i][c + j] = true;
						matrix[r + i][c + j] =
							Math.abs(i) === 2 || Math.abs(j) === 2 || (i === 0 && j === 0);
					}
				}
			}
		}
	}

	// Reserve format info areas
	for (let i = 0; i < 9; i++) {
		reserved[8][i] = true;
		reserved[i][8] = true;
		if (modules - 1 - i >= modules - 8) {
			reserved[8][modules - 1 - i] = true;
			reserved[modules - 1 - i][8] = true;
		}
	}

	// Place data bits with Mask 0 ((row + col) % 2 === 0)
	const dataBitsList: number[] = [];
	for (const cw of finalCodewords) {
		for (let b = 7; b >= 0; b--) {
			dataBitsList.push((cw >>> b) & 1);
		}
	}

	let bitIdx = 0;
	let upward = true;
	for (let col = modules - 1; col > 0; col -= 2) {
		if (col === 6) col--; // Skip vertical timing column
		const rows = upward
			? Array.from({ length: modules }, (_, i) => modules - 1 - i)
			: Array.from({ length: modules }, (_, i) => i);

		for (const row of rows) {
			for (const c of [col, col - 1]) {
				if (!reserved[row][c]) {
					const bit = bitIdx < dataBitsList.length ? dataBitsList[bitIdx++] : 0;
					// Apply Mask 0: flip if (row + c) % 2 === 0
					const masked = bit ^ ((row + c) % 2 === 0 ? 1 : 0);
					matrix[row][c] = masked === 1;
				}
			}
		}
		upward = !upward;
	}

	// Format information: EC Level M (00) + Mask 0 (000) = 00000 -> BCH format bits = 101010000010010
	const FORMAT_BITS = [1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0];
	for (let i = 0; i < 6; i++) matrix[8][i] = FORMAT_BITS[i] === 1;
	matrix[8][7] = FORMAT_BITS[6] === 1;
	matrix[8][8] = FORMAT_BITS[7] === 1;
	matrix[7][8] = FORMAT_BITS[8] === 1;
	for (let i = 9; i < 15; i++) matrix[14 - i][8] = FORMAT_BITS[i] === 1;

	for (let i = 0; i < 8; i++) matrix[modules - 1 - i][8] = FORMAT_BITS[i] === 1;
	for (let i = 8; i < 15; i++) matrix[8][modules - 15 + i] = FORMAT_BITS[i] === 1;

	// Render SVG paths
	let path = '';
	const margin = 4;
	const totalSize = modules + margin * 2;

	for (let r = 0; r < modules; r++) {
		for (let c = 0; c < modules; c++) {
			if (matrix[r][c]) {
				path += `M${c + margin},${r + margin}h1v1h-1z `;
			}
		}
	}

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}" width="${size}" height="${size}" shape-rendering="crispEdges">
		<rect width="${totalSize}" height="${totalSize}" fill="#ffffff"/>
		<path d="${path}" fill="#0f172a"/>
	</svg>`;
}
