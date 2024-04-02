import type { PublicKey } from "@solana/web3.js";

export interface CreateOrderResponse {
	tx: string;
	orderPubkey: string;
}

export interface CreateOrderOptions {
	inAmount: number;
	outAmount: number;
	inputMint: PublicKey;
	outputMint: PublicKey;
	expiredAt?: number;
	referralAccount?: PublicKey;
	referralName?: string;
}

export interface Config {
	accounts_path: string;
	rpc_url: string;
	fee_payer: string;
	input_mints: MintRoot;
	output_mints: MintRoot;
}

export interface MintRoot {
	[key: string]: {
		amount_range: [number, number];
	};
}
