//! Tests of the crypto modules, one file per module. The known-answer vectors pin stored and wire formats that released
//! clients and the server depend on: a failing vector means they no longer agree, so never regenerate one.

mod aad;
mod aes_gcm;
mod argon2;
mod avex;
mod jwk;
mod key_chain;
mod mobile_login;
mod pin;
mod rsa_oaep;
mod signing;
mod srp;
mod tokens;
