export interface OrderRequest {
  tokenIn: 'SOL' | 'USDC' | 'USDT' | 'ETH';
  tokenOut: 'SOL' | 'USDC' | 'USDT' | 'ETH';
  amount: number;
}

export type OrderStatus = 'pending' | 'routing' | 'building' | 'submitted' | 'confirmed' | 'failed';

export interface Order {
  id: string;
  tokenIn: string;
  tokenOut: string;
  amount: number;
  status: OrderStatus;
  txHash?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}