import * as dotenv from "dotenv"
dotenv.config()

import axios from 'axios'
import delay from 'delay'

import { ethers } from 'ethers'
import { Wallet } from '@ethersproject/wallet'
import { JsonRpcProvider } from '@ethersproject/providers'
import { BigNumber } from "@ethersproject/bignumber"
import { formatEther, parseEther } from '@ethersproject/units'
import SoulStoreABI from './SoulStore.json'
import SoulNameABI from './SoulName.json'

import prompt from 'prompt-async'
import { promises as fs } from 'fs'
import * as path from 'path'

import userAgent from 'user-agents'
// import { HttpsProxyAgent } from 'https-proxy-agent'

const SOUL_CONTRACT = '0x4454d3892124Ad4d859770660495461D1C5a37F3'
const SOUL_NAME_CONTRACT = '0x15987A0417D14cc6f3554166bCB4A590f6891B18'
let domains = []
const gasLimit = 700000
const phoneNumber = '+79933471245'
const maxDomains = 1

// const provider = ethers.getDefaultProvider('goerli')
const provider = new JsonRpcProvider('https://goerli.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161')
const randomInt = (value) => Math.floor(Math.random() * value)

// Signature message
const getLoginMessage = (data) => `Welcome to 🌽Masa Finance!

Login with your soulbound web3 identity to unleash the power of DeFi.

Your signature is valid till: ${data.expires}.
Challenge: ${data.challenge}`

// Check availiable of domain
const isAvailable = async (domain) => {
  console.log(`Check availability of «${domain}»`)
  const contract = new ethers.Contract(SOUL_NAME_CONTRACT, SoulNameABI, provider)
  return contract.isAvailable(domain)
}

// Get identity ID
const getIdentity = async (address) => {
  console.log(`Get identity for ${address}`)
  const contract = new ethers.Contract(SOUL_NAME_CONTRACT, SoulNameABI, provider)
  const identity = await contract.tokenOfOwnerByIndex(address, BigNumber.from(0)).catch(e => null)
  return identity ? identity.toString() : null
}

// NFT balance
const getBalance = async (address) => {
  console.log(`Get NFT balance of ${address}`)
  const contract = new ethers.Contract(SOUL_NAME_CONTRACT, SoulNameABI, provider)
  return await contract.balanceOf(address).then(r => r.toNumber()).catch(e => -1)
}

// Create NFT
const createNFT = async (signer, domain, years, metaId, method = 'purchaseIdentityAndName') => {
  try {
    const contract = new ethers.Contract(SOUL_CONTRACT, SoulStoreABI, signer)
    const gasPrice = (await provider.getGasPrice()).mul(110).div(100)
    console.log('Gas price', gasPrice.toString())
    const value = await contract.purchaseNameInfo(domain, BigNumber.from(years))
    console.log('Estimate value of NFT:', formatEther(value.priceInETH))
    console.log(`Try send transaction to mint «${domain}» for ${years} years...`)
    const tx = await contract[method]('0x0000000000000000000000000000000000000000', domain, BigNumber.from(years), 'ar://' + metaId, {
      gasLimit: gasLimit,
      gasPrice: gasPrice,
      value: value.priceInETH
    })
    return tx
  } catch (e) {
    console.log(e)
    return null
  }
}

// Get Meta of future NFT
const getNFTmeta = async (account, domain) =>
  account.post("storage/store", { soulName: `${domain}.soul` })
    .then(async (r) => {
      const metaId = r.data.metadataTransaction
      return r.data.metadataTransaction
    })
    .catch(e => console.log('Get NFT meta error', e))

// Log in by signature
const login = async (initial, signer) =>
  initial
    .get('/session/get-challenge')
    .then(async (r) => {
      console.log(r.data)
      const message = getLoginMessage(r.data)
      const signature = await signer.signMessage(message)
      const cookie = r.headers['set-cookie'] ? r.headers['set-cookie'].join('; ') : ''
      return initial.post("/session/check-signature", { address: signer.address, signature: signature }, { headers: { cookie: cookie }})
        .then(async (r) => {
          return cookie
        })
        .catch(e => {
          console.log('Check signature error')
          return null
        })
    })
    .catch(e => {
      console.log(e)
      return null
    })

// Request sms code
const generate2fa = async (account, phoneNumber) => account.post("2fa/generate", { phoneNumber: phoneNumber }).then(r => r.data).catch(e => console.log(e))

// 2fa auth request
const verify2fa = async (account, signer, identity, phoneNumber, code) => {
 const signature = await signer.signMessage(`Identity: ${identity} Phone Number: ${phoneNumber} Code: ${code}`)
  console.log('Try send 2fa mint verification:', identity, phoneNumber, code, signature)
  return account.post("2fa/mint", {
    address: signer.address,
    phoneNumber: phoneNumber,
    code: code,
    signature: signature
  }).then(r => {
    console.log(r.data)
    return true
  }).catch(e => {
    console.log('2fa error', e)
    return false
  })
}

// Check session
const check = async (account) => await account.get("session/check").catch(e => false)

const registerMasaDomain = async (instance, key, domain, years, maintenance = false, saved = false) => {
  const signer = new Wallet(key, provider)
  const balance = await provider.getBalance(signer.address)

  if (!cookies[signer.address] && saved)
    return 'Skip profile without saved cookies'
    
  console.log(`Register in Masa.finance | ${signer.address} | ${formatEther(balance)} | ${domain} | ${years}`)

  if (!cookies[signer.address]) {
    cookies[signer.address] = await login(instance, signer)
    await fs.writeFile('cookies.json', JSON.stringify(cookies))
  } else console.log('Use saved cookies...')

  const account = instance
  account.defaults.headers.cookie = cookies[signer.address]

  if (await check(account))
    console.log('Account login and check complete!')
  else
    return 'Authentitication error :('

  const token_balance = await getBalance(signer.address)
  if (token_balance < maxDomains) {

    if (parseFloat(formatEther(balance)) < 0.1)
      return `Wallet balance < 0.1, can't mint NFT. Use faucets like https://goerlifaucet.com/ or https://faucets.chain.link/`

    while(!(await isAvailable(domain)))
      domain = domains[randomInt(domains.length)]

    if (await isAvailable(domain)) {
      console.log(`Domain «${domain}» available, minting...`)
      const meta = await getNFTmeta(account, domain)
      const tx = await createNFT(signer, domain, years, meta.id, token_balance === 0 ? 'purchaseIdentityAndName' : 'purchaseName')
      if (tx)
        await tx.wait()
    } else {
      console.log(`Domain «${domain}» is not available!`)
    }
  } else console.log('Max domains for account limit reached')

  const identity = await getIdentity(signer.address)
  console.log('Identity: ', identity)
  
  if (!identity)
    return 'The address does not have an identity ID'
  
  if (maintenance)
    return 'Maintenance mode on, code not needed'

  const generate = await generate2fa(account, phoneNumber)
  if (generate.success) {
    prompt.start()
    console.log(`Code sended, wait it and input to bash:`)
    const { code } = await prompt.get(["code"])
    return await verify2fa(account, signer, identity, phoneNumber, code)
      ? `Hurray! 🎉 You are now registered for the Masa Token Airdrop!`
      : `Verification failed! See logs...`
  } else {
    return `Code generation error: ${generate.message}`
  }
}

let cookies = {}
const main = async () => {
  cookies = JSON.parse(await fs.readFile('cookies.json', 'utf8'))

  const keys = (await fs.readFile('keys.txt', 'utf8')).split('\n').filter(item => item.length >= 64)
  domains = [...domains, ...(await fs.readFile('domains.txt', 'utf8')).split('\n')]
  // const proxies = (await fs.readFile('proxies.txt', 'utf8')).split('\n')

  for (let i = 0; i < keys.length; i++) {
    const instance = axios.create({
      baseURL: 'https://beta.middleware.masa.finance',
      headers: {
        "accept": "*/*",
        "accept-encoding": "gzip, deflate, br",
        "accept-language": "ru",
        "authorization": "undefined",
        "content-type": "application/json",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
        "user-agent": userAgent.random().toString(),
        "origin": "https://beta.claimyoursoul.masa.finance",
        "Referer": "https://beta.claimyoursoul.masa.finance/",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "cookie": "amp_de9b3a=rHyuk63oDk3SHtA1yfWM2h...1gi1k3f78.1gi1k3f78.0.0.0"
      },
      // httpAgent: proxies[i] ? new HttpsProxyAgent(proxies[i]) : null
    })

    console.log(`\n==================================\n`)
    console.log(
      await registerMasaDomain(instance, keys[i], domains[i], 2 + randomInt(5), true, false)
    )
    await delay (3000)
  }
}

main()