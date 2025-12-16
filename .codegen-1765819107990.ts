import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://www.google.com/?zx=1765819118414&no_sw_cr=1');
  await page.getByRole('combobox', { name: 'Search' }).click();
  await page.getByRole('combobox', { name: 'Search' }).fill('pushpendu singh test');
  await page.goto('https://www.google.com/sorry/index?continue=https://www.google.com/search%3Fq%3Dpushpendu%2Bsingh%2Btest%26sca_esv%3D908d569159eb1a2e%26source%3Dhp%26ei%3D60JAaZqpFseW4-EPwJaJmQg%26iflsig%3DAOw8s4IAAAAAaUBQ-6HxC8L5n7qW1Han8dC6ombZoG0I%26ved%3D0ahUKEwjayu_ojMCRAxVHyzgGHUBLIoMQ4dUDCBU%26uact%3D5%26oq%3Dpushpendu%2Bsingh%2Btest%26gs_lp%3DEgdnd3Mtd2l6GgIYAiIUcHVzaHBlbmR1IHNpbmdoIHRlc3QyBRAhGKABMgUQIRigATIFECEYoAFIwjVQwgpYqzBwAXgAkAEAmAF-oAGND6oBBDE2LjS4AQPIAQD4AQGYAhWgApEQqAIKwgIKEAAYAxjqAhiPAcICCxAAGIAEGLEDGIMBwgIOEC4YgAQYsQMY0QMYxwHCAgUQLhiABMICCBAAGIAEGLEDwgILEC4YgAQYsQMYgwHCAgUQABiABMICCBAuGIAEGLEDwgIOEC4YgAQYsQMYxwEYrwHCAhEQLhiABBixAxjHARiOBRivAcICERAuGIAEGLEDGIMBGMcBGK8BwgIGEAAYFhgewgICECbCAgUQABjvBcICCBAAGIAEGKIEwgIIEAAYogQYiQWYAwjxBbb4Wp_Z6GBFkgcFMTEuMTCgB8CpAbIHBTEwLjEwuAeJEMIHBjAuNy4xNMgHWYAIAA%26sclient%3Dgws-wiz%26sei%3D90JAaZ38FODu4-EP5bWOwQw&q=EhAkBQIB0Bmgm_k3ViWbLaM8GPeFgcoGIjB0WXyjXJzDh1frjAC709kf0Fb3VW6Go_Q-YKJmsFOVsV31dcHRHOu5Q2rBG_Ve0f4yAVJaAUM');
});