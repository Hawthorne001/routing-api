import {
  ChainId,
  IV2SubgraphProvider,
  IV3SubgraphProvider,
  log,
  V2SubgraphPool,
  V3SubgraphPool,
} from '@uniswap/smart-order-router'
import { Protocol } from '@uniswap/smart-order-router/build/main/util/protocols'
import { S3 } from 'aws-sdk'
import NodeCache from 'node-cache'
import { S3_POOL_CACHE_KEY } from '../../util/pool-cache-key'

const POOL_CACHE = new NodeCache({ stdTTL: 240, useClones: false })
const LOCAL_POOL_CACHE_KEY = (chainId: ChainId) => `pools${chainId}`

export class AWSSubgraphProvider<TSubgraphPool extends V2SubgraphPool | V3SubgraphPool> {
  constructor(private chain: ChainId, private protocol: Protocol, private bucket: string, private baseKey: string) {}

  public async getPools(): Promise<TSubgraphPool[]> {
    const s3 = new S3()

    const cachedPools = POOL_CACHE.get<TSubgraphPool[]>(LOCAL_POOL_CACHE_KEY(this.chain))

    if (cachedPools) {
      log.info(
        { subgraphPoolsSample: cachedPools.slice(0, 5) },
        `Subgraph pools fetched from local cache for protocol ${this.protocol}. Num: ${cachedPools.length}`
      )

      return cachedPools
    }

    log.info(
      { bucket: this.bucket, key: this.baseKey },
      `Subgraph pools local cache miss for protocol ${this.protocol}. Getting subgraph pools from S3`
    )
    const pools = await cachePoolsFromS3<TSubgraphPool>(s3, this.bucket, this.baseKey, this.chain, this.protocol)

    return pools
  }
}

export const cachePoolsFromS3 = async <TSubgraphPool>(
  s3: S3,
  bucket: string,
  baseKey: string,
  chainId: ChainId,
  protocol: Protocol
) => {
  const key = S3_POOL_CACHE_KEY(baseKey, chainId, protocol)

  const result = await s3.getObject({ Key: key, Bucket: bucket }).promise()

  const { Body: poolsBuffer } = result

  if (!poolsBuffer) {
    throw new Error(`Could not get subgraph pool cache from S3 for protocol ${protocol}`)
  }

  const pools = JSON.parse(poolsBuffer.toString('utf-8')) as TSubgraphPool[]

  log.info({ bucket, key }, `Got subgraph pools from S3 for protocol ${protocol} on ${chainId}. Num: ${pools.length}`)

  POOL_CACHE.set<TSubgraphPool[]>(LOCAL_POOL_CACHE_KEY(chainId), pools)

  return pools
}

export class V3AWSSubgraphProvider extends AWSSubgraphProvider<V3SubgraphPool> implements IV3SubgraphProvider {
  constructor(chainId: ChainId, bucket: string, baseKey: string) {
    super(chainId, Protocol.V3, bucket, baseKey)
  }

  public static async EagerBuild(bucket: string, baseKey: string, chainId: ChainId): Promise<V3AWSSubgraphProvider> {
    const s3 = new S3()
    await cachePoolsFromS3<V3SubgraphPool>(s3, bucket, baseKey, chainId, Protocol.V3)

    return new V3AWSSubgraphProvider(chainId, bucket, baseKey)
  }
}

export class V2AWSSubgraphProvider extends AWSSubgraphProvider<V2SubgraphPool> implements IV2SubgraphProvider {
  constructor(chainId: ChainId, bucket: string, key: string) {
    super(chainId, Protocol.V2, bucket, key)
  }

  public static async EagerBuild(bucket: string, baseKey: string, chainId: ChainId): Promise<V2AWSSubgraphProvider> {
    const s3 = new S3()
    await cachePoolsFromS3<V2SubgraphPool>(s3, bucket, baseKey, chainId, Protocol.V3)

    return new V2AWSSubgraphProvider(chainId, bucket, baseKey)
  }
}
