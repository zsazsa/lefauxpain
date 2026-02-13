//go:build !desktop

package main

const guiMode = false

func runGUI(addr string) {}

func runGUIRemote(remoteURL string) {}
