import {
	VersionedTransaction,
	Connection,
	Keypair,
	PublicKey,
	Transaction,
} from "@solana/web3.js";
import type { Config, CreateOrderOptions, CreateOrderResponse } from "./types";
import ora from "ora";
import { TOML } from "bun";
import { decode } from "bs58";
import { readFile } from "fs/promises";
import { setTimeout } from "timers/promises";
import { choice, random } from "./utils";
import {
	getAccount,
	getAssociatedTokenAddressSync,
	getMint,
} from "@solana/spl-token";

export const CREATE_ORDER_ENDPOINT = "https://jup.ag/api/limit/v1/createOrder";
export const QUOTE_ENDPOINT = "https://quote-api.jup.ag/v6/quote";

class LimitkaJupiter {
	keypair: Keypair;
	connection: Connection;

	constructor(connection: Connection, keypair: Keypair) {
		this.connection = connection;
		this.keypair = keypair;
	}

	async createOrder({
		inputMint,
		outputMint,
		inAmount,
		outAmount,
		referralAccount,
		referralName,
		expiredAt,
	}: CreateOrderOptions) {
		const owner = this.keypair.publicKey;
		const base = Keypair.generate();

		const data = (await (
			await fetch(CREATE_ORDER_ENDPOINT, {
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					owner: owner.toString(),
					inAmount, // 1000000 => 1 USDC if inputToken.address is USDC mint
					outAmount,
					expiredAt,
					inputMint: inputMint.toString(),
					outputMint: outputMint.toString(),
					base: base.publicKey.toString(),
					// referralAccount and name are both optional
					// provide both to get referral fees
					// more details in the section below
					referralAccount,
					referralName,
				}),
				method: "POST",
			})
		).json()) as CreateOrderResponse;

		console.log(data);

		if ("error" in data) {
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			throw new Error(data.error as any);
		}

		return Transaction.from(Buffer.from(data.tx, "base64"));
	}
}

async function sendTransaction(
	connection: Connection,
	tx: Transaction,
	feePayer: PublicKey,
	signers: Keypair[],
) {
	tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
	tx.feePayer = feePayer;
	tx.sign(...signers);

	return await connection.sendRawTransaction(tx.serialize());
}

async function getDecimals(connection: Connection, mint: PublicKey) {
	const mintData = await getMint(connection, mint);
	return mintData.decimals;
}

async function main() {
	const spinner = ora("СТАРТИНГ Аккаунтс процессинг!!!!").start();

	const config = TOML.parse(
		await readFile("./config.toml", { encoding: "utf8" }),
	) as Config;

	let feePayer: Keypair | undefined = undefined;

	if (config.fee_payer) {
		feePayer = Keypair.fromSecretKey(decode(config.fee_payer));
	}

	if (!config.input_mints && !config.output_mints) {
		return spinner.fail(
			"Ну ты совсем? Почему ты не указал куда во что свопать?",
		);
	}

	const inputsMints = Object.entries(config.input_mints).map(
		([tokenRaw, data]) => [new PublicKey(tokenRaw), data],
	) as [PublicKey, { amount_range: [number, number] }][];

	const outputMints = Object.entries(config.output_mints).map(
		([tokenRaw, data]) => [new PublicKey(tokenRaw), data],
	) as [PublicKey, { amount_range: [number, number] }][];

	if (!config.rpc_url) {
		return spinner.fail("Ну почему ты не указал rpc_url?");
	}

	const connection = new Connection(config.rpc_url);

	if (!config.accounts_path) {
		return spinner.fail(
			"Ну что ж такое то?? все вроде указал, а accounts_path нет...",
		);
	}

	let accounts: Keypair[];

	try {
		accounts = (await readFile(config.accounts_path, { encoding: "utf-8" }))
			.split("\n")
			.map(decode)
			.map((kp) => Keypair.fromSecretKey(kp));
	} catch (e) {
		return spinner.fail("Ну файла то с аккаунтами нет!");
	}

	spinner.text = `Загружено ${accounts.length} аккаунтов`;
	await setTimeout(5000);

	// new LimitkaJupiter(connection, Keypair.generate()).createOrder({
	// 	inputMint: new PublicKey("So11111111111111111111111111111111111111112"),
	// 	outputMint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
	// 	inAmount: 1000000,
	// 	outAmount: 1000000,
	// });

	for (const account of accounts) {
		spinner.text = `ПРОЦЕССИНГ ${account.publicKey.toString()}`;
		const jupSwap = new LimitkaJupiter(connection, account);

		const [inputMint, { amount_range: inputAmountRange }] = choice(inputsMints);
		const [outputMint, { amount_range: outputAmountRange }] =
			choice(outputMints);

		const inputMintDecimals = await getDecimals(connection, inputMint);
		const outputMintDecimals = await getDecimals(connection, outputMint);

		const inAmount = random(
			...(inputAmountRange.map(
				(value) => value * 10 ** inputMintDecimals,
			) as unknown as [number, number]),
		);
		const outAmount = random(
			...(inputAmountRange.map(
				(value) => value * 10 ** inputMintDecimals,
			) as unknown as [number, number]),
		);

		const tx = await jupSwap.createOrder({
			inputMint,
			outputMint,
			inAmount,
			outAmount,
		});

		spinner.text = await sendTransaction(
			connection,
			tx,
			feePayer ? feePayer.publicKey : account.publicKey,
			feePayer ? [feePayer, account] : [account],
		);

		await setTimeout(5000);
	}
}

await main();
