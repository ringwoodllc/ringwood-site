import UIKit
import WebKit

/// The whole app: ringwood.ai in a WKWebView.
/// - Pinned below the status bar (the paper color fills behind it), so web
///   content never collides with the clock the way the first build did.
/// - Camera and photo-library uploads work through the normal <input type=file>.
/// - Links that leave ringwood.ai (order portals, TestFlight, tel:, mailto:)
///   open outside the app; everything on our domain stays in.
/// - Pull down to refresh.
class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {

    private let homeURL = URL(string: "https://ringwood.ai/app")!
    private let appHost = "ringwood.ai"
    private var webView: WKWebView!

    // Ringwood paper, behind the status bar and during loads.
    private let paper = UIColor(red: 0.957, green: 0.937, blue: 0.894, alpha: 1.0)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = paper

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.websiteDataStore = .default()   // keep the login across launches

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .automatic
        webView.backgroundColor = paper
        webView.scrollView.backgroundColor = paper
        webView.isOpaque = false

        let refresh = UIRefreshControl()
        refresh.addTarget(self, action: #selector(reloadPage(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = refresh

        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])

        webView.load(URLRequest(url: homeURL))
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .darkContent }

    @objc private func reloadPage(_ sender: UIRefreshControl) {
        if webView.url != nil { webView.reload() } else { webView.load(URLRequest(url: homeURL)) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { sender.endRefreshing() }
    }

    // If the web app ever fails to load (offline on first run), retry rather
    // than strand the user on a blank view.
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let alert = UIAlertController(title: "Can't reach Ringwood",
                                      message: "Check your connection and try again.",
                                      preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Retry", style: .default) { _ in
            webView.load(URLRequest(url: self.homeURL))
        })
        present(alert, animated: true)
    }

    // Keep ringwood.ai (and subdomains) inside the app; send everything else out.
    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.allow); return }
        let scheme = url.scheme?.lowercased() ?? ""
        if scheme != "http" && scheme != "https" {
            // tel:, mailto:, facetime:, itms-apps: and friends go to the system.
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        let host = url.host?.lowercased() ?? ""
        let ours = host == appHost || host.hasSuffix("." + appHost)
        if !ours && navigationAction.navigationType == .linkActivated {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    // target=_blank: open our own pages in place, external ones in Safari.
    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            let host = url.host?.lowercased() ?? ""
            if host == appHost || host.hasSuffix("." + appHost) {
                webView.load(navigationAction.request)
            } else {
                UIApplication.shared.open(url)
            }
        }
        return nil
    }
}
