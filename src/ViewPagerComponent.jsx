import React, { Component, PropTypes, Children, cloneElement, createElement } from 'react'
import ReactDOM, { findDOMNode } from 'react-dom'
import ElementBase from './ElementBase'
import Views from './Views'
import ViewComponent from './ViewComponent'
import getIndex from './get-index'

// react-view-pager
// const Slider = ({ slides }) => (
//   <Frame>
//     { ({ position, isSliding, isSwiping }) =>
//       <Motion style={{ value: isSwiping ? position : spring(position) }}>
//         { value =>
//           <Track position={value}> // overrides internal position
//             {slides} // that position would set proper wrapper values
//           </Track>
//         }
//       </Motion>
//     }
//   </Frame>
// )

const TRANSFORM = require('get-prefix')('transform')

function modulo(val, max) {
  return ((val % max) + max) % max
}

function clamp(val, min, max) {
  return Math.min(Math.max(min, val), max)
}

function getTouchEvent(e) {
  return e.touches && e.touches[0] || e
}

class ViewPager extends Component {
  static propTypes = {
    currentView: PropTypes.any,
    viewsToShow: PropTypes.number,
    viewsToMove: PropTypes.number,
    align: PropTypes.number,
    contain: PropTypes.bool,
    axis: PropTypes.oneOf(['x', 'y']),
    autoSize: PropTypes.bool,
    infinite: PropTypes.bool,
    instant: PropTypes.bool,
    swipe: PropTypes.oneOf([true, false, 'mouse', 'touch']),
    swipeThreshold: PropTypes.number, // to advance slides, the user must swipe a length of (1/touchThreshold) * the width of the slider
    flickTimeout: PropTypes.number,
    // edgeFriction: PropTypes.number,
    // rightToLeft: PropTypes.bool,
    // lazyLoad: PropTypes.bool,
    // springConfig: React.PropTypes.objectOf(React.PropTypes.number),
    // onReady: PropTypes.func,
    beforeAnimation: PropTypes.func,
    afterAnimation: PropTypes.func
  }

  static defaultProps = {
    currentView: 0,
    viewsToShow: 0,
    viewsToMove: 1,
    align: 0,
    contain: false,
    axis: 'x',
    autoSize: false,
    infinite: true,
    instant: false,
    swipe: true,
    swipeThreshold: 0.5,
    flickTimeout: 300,
    // edgeFriction: 0, // the amount the slider can swipe past the ends if infinite is false
    // rightToLeft: false,
    // lazyLoad: false, // lazyily load components as they enter
    // springConfig: presets.gentle,
    // onReady: () => null,
    onChange: () => null,
    beforeAnimation: () => null,
    afterAnimation: () => null
  }

  constructor(props) {
    super(props)

    this._views = new Views(props.axis, props.viewsToShow, props.infinite)
    this._viewCount = Children.count(props.children)

    // swiping
    this._startSwipe = {}
    this._swipeDiff = {}
    this._isSwiping = false
    this._isFlick = false

    this.state = {
      trackPosition: 0,
      currentView: getIndex(props.currentView, props.children)
    }
  }

  componentDidMount() {
    const { autoSize, axis } = this.props

    this._frame = new ElementBase({
      node: this._frameNode,
      width: autoSize && this._getCurrentViewSize('width'),
      height: autoSize && this._getCurrentViewSize('height'),
      axis
    })

    this._track = new ElementBase({
      node: this._trackNode,
      axis
    })

    // set frame and track for views to access
    this._views.setFrame(this._frame)
    this._views.setTrack(this._track)

    // set positions so we can get a total width
    this._views.setPositions()

    // set track width to the size of views
    const totalViewSize = this._views.getTotalSize()
    this._track.setSize(totalViewSize, totalViewSize)

    // finally, set the initial track position
    this._setTrackPosition(this._getStartCoords())
  }

  componentWillReceiveProps({ currentView, children }) {
    // update state with new index if necessary
    if (typeof currentView !== undefined && this.props.currentView !== currentView) {
      this.setState({
        currentView: getIndex(currentView, children)
      })
    }
  }

  componentDidUpdate(lastProps, lastState) {
    if (this.state.currentView !== lastState.currentView) {
      // reposition slider if index has changed
      this._setTrackPosition(this._getStartCoords())

      // update frame size to match new view size
      if (this.props.autoSize) {
        const width = this._getCurrentViewSize('width')
        const height = this._getCurrentViewSize('height')

        // update frame size
        this._frame.setSize(width, height)

        // update view positions
        this._views.setPositions()
      }
    }
  }

  prev() {
    this.slide(-1)
  }

  next() {
    this.slide(1)
  }

  slide = (direction, index = this.state.currentView) => {
    const { children, viewsToMove, infinite } = this.props
    const newIndex = index + (direction * viewsToMove)
    const currentView = infinite
      ? modulo(newIndex, this._viewCount)
      : clamp(newIndex, 0, this._viewCount - 1)

    this.setState({ currentView }, () => {
      this.props.onChange(currentView)
    })
  }

  _handleViewMount = (node) => {
    this._views.addView(node)
    this.forceUpdate()
  }

  _getStartCoords(index = this.state.currentView) {
    return this._views.getStartCoords(index)
  }

  _getCurrentViewSize(dimension) {
    const currentView = this._views.collection[this.state.currentView]
    return currentView && currentView.getSize(dimension) || 0
  }

  _getAlignOffset() {
    const { align, viewsToShow } = this.props
    const frameSize = this._frame.getSize()
    const currentViewSize = this._getCurrentViewSize()
    return (frameSize - (currentViewSize / (viewsToShow || 1))) * align
  }

  _setTrackPosition(position, bypassContain) {
    const { infinite, contain } = this.props
    const frameSize = this._frame.getSize()
    const trackSize = this._track.getSize()

    // wrapping
    if (infinite) {
      position = modulo(position, trackSize) - trackSize
    }

    // alignment
    position += this._getAlignOffset()

    // contain
    if (!bypassContain && contain) {
      position = clamp(position, frameSize - trackSize, 0)
    }

    // set new track position
    this._track.setPosition(position)

    // update view positions
    this._views.setPositions()

    // update state
    this.setState({
      trackPosition: position
    })
  }

  _isOutOfBounds(trackPosition) {
    const frameEnd = (this._track.getSize() - this._frame.getSize())
    return trackPosition > 0 || Math.abs(trackPosition) > frameEnd
  }

  _isSwipe(threshold) {
    const { axis } = this.props
    let { x, y } = this._swipeDiff
    return axis === 'x'
      ? Math.abs(x) > Math.max(threshold, Math.abs(y))
      : Math.abs(x) < Math.max(threshold, Math.abs(y))
  }

  _onSwipeStart = (e) => {
    const { pageX, pageY } = getTouchEvent(e)

    // we're now swiping
    this._isSwiping = true

    // store the initial starting coordinates
    this._startTrack = this._track.getPosition() - this._getAlignOffset()
    this._startSwipe = {
      x: pageX,
      y: pageY
    }

    // determine if a flick or not
    this._isFlick = true

    setTimeout(() => {
      this._isFlick = false
    }, this.props.flickTimeout)
  }

  _onSwipeMove = (e) =>  {
    // bail if we aren't swiping
    if (!this._isSwiping) return

    const { swipeThreshold, axis, viewsToMove } = this.props
    const { pageX, pageY } = getTouchEvent(e)

    // determine how much we have moved
    this._swipeDiff = {
      x: this._startSwipe.x - pageX,
      y: this._startSwipe.y - pageY
    }

    if (this._isSwipe(swipeThreshold)) {
      e.preventDefault()
      e.stopPropagation()

      // let swipDiff = this._swipeDiff[axis] * edgeFriction
      let swipeDiff = this._swipeDiff[axis]
      let newTrackPosition = (this._startTrack - swipeDiff) * viewsToMove
      let isOutOfBounds = this._isOutOfBounds(newTrackPosition)

      if (isOutOfBounds) {
        // add resistance here
        // this.props.edgeFriction
      }

      this._setTrackPosition(newTrackPosition, isOutOfBounds)
    }
  }

  _onSwipeEnd = () =>  {
    const { swipeThreshold, axis, infinite } = this.props
    const { trackPosition } = this.state
    const currentViewSize = this._getCurrentViewSize()
    const threshold = this._isFlick ? swipeThreshold : (currentViewSize * swipeThreshold)

    // if "contain" is activated and we have swiped past the frame we need to
    // reset the value back to the clamped position
    if (!infinite && this._isOutOfBounds(trackPosition)) {
      this._setTrackPosition(trackPosition, false)
    }

    // if (this._isSwipe(threshold)) {
    //   (this._swipeDiff[axis] < 0) ? this.prev() : this.next()
    // }

    this._isSwiping = false
  }

  _onSwipePast = () =>  {
    // perform a swipe end if we swiped past the component
    if (this._isSwiping) {
      this._onSwipeEnd()
    }
  }

  _getSwipeEvents() {
    const { swipe } = this.props
    let swipeEvents = {}

    if (swipe === true || swipe === 'mouse') {
      swipeEvents.onMouseDown = this._onSwipeStart
      swipeEvents.onMouseMove = this._onSwipeMove
      swipeEvents.onMouseUp = this._onSwipeEnd
      swipeEvents.onMouseLeave = this._onSwipePast
    }

    if (swipe === true || swipe === 'touch') {
      swipeEvents.onTouchStart = this._onSwipeStart
      swipeEvents.onTouchMove = this._onSwipeMove
      swipeEvents.onTouchEnd = this._onSwipeEnd
    }

    return swipeEvents
  }

  _getPositionValue(position) {
    const frameSize = this._frame && this._frame.getSize() || 0
    return Math.round(position / frameSize * 10000) * 0.01
  }

  _getTransformValue(trackPosition) {
    const { axis } = this.props
    const position = { x: 0, y: 0 }
    position[axis] = trackPosition || 0
    return `translate3d(${position.x}%, ${position.y}%, 0)`
  }

  render() {
    const { autoSize, viewsToShow, axis, children } = this.props
    const trackPosition = this._getPositionValue(this.state.trackPosition)
    const frameStyles = {}

    if (autoSize) {
      frameStyles.width = this._getCurrentViewSize('width') || 'auto'
      frameStyles.height = this._getCurrentViewSize('height') || 'auto'
    }

    return (
      <div
        ref={c => this._frameNode = findDOMNode(c)}
        className="frame"
        style={frameStyles}
        {...this._getSwipeEvents()}
      >
        <div
          ref={c => this._trackNode = findDOMNode(c)}
          className="track"
          style={{
            [TRANSFORM]: this._getTransformValue(trackPosition)
          }}
        >
          {Children.map(children, (child, index) =>
            <ViewComponent
              view={this._views.collection[index] || {}}
              viewsToShow={viewsToShow}
              axis={axis}
              onMount={this._handleViewMount}
              children={child}
            />
          )}
        </div>
      </div>
    )
  }
}

export default ViewPager