include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-komari
PKG_VERSION:=2.0.0
PKG_RELEASE:=1
PKG_PO_VERSION:=$(PKG_VERSION)-r$(PKG_RELEASE)
PKG_LICENSE:=Apache-2.0

LUCI_TITLE:=Komari server and Agent LuCI application
LUCI_DESCRIPTION:=LuCI management page and service integration for the Komari server and web dashboard.
LUCI_DEPENDS:=+luci-base +jsonfilter +uclient-fetch +ca-bundle +coreutils-timeout
LUCI_PKGARCH:=all

define Package/luci-app-komari/conffiles
/etc/config/komari
/etc/config/komari_agent
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
