define([
        '../Core/ApproximateTerrainHeights',
        '../Core/Cartesian3',
        '../Core/Check',
        '../Core/Color',
        '../Core/ColorGeometryInstanceAttribute',
        '../Core/defined',
        '../Core/DeveloperError',
        '../Core/DistanceDisplayConditionGeometryInstanceAttribute',
        '../Core/EllipseGeometry',
        '../Core/EllipseOutlineGeometry',
        '../Core/GeometryInstance',
        '../Core/GeometryOffsetAttribute',
        '../Core/Iso8601',
        '../Core/OffsetGeometryInstanceAttribute',
        '../Core/Rectangle',
        '../Core/ShowGeometryInstanceAttribute',
        '../Scene/GroundPrimitive',
        '../Scene/HeightReference',
        '../Scene/MaterialAppearance',
        '../Scene/PerInstanceColorAppearance',
        './ColorMaterialProperty',
        './DynamicGeometryUpdater',
        './GeometryUpdater',
        './GroundGeometryUpdater',
        './Property'
    ], function(
        ApproximateTerrainHeights,
        Cartesian3,
        Check,
        Color,
        ColorGeometryInstanceAttribute,
        defined,
        DeveloperError,
        DistanceDisplayConditionGeometryInstanceAttribute,
        EllipseGeometry,
        EllipseOutlineGeometry,
        GeometryInstance,
        GeometryOffsetAttribute,
        Iso8601,
        OffsetGeometryInstanceAttribute,
        Rectangle,
        ShowGeometryInstanceAttribute,
        GroundPrimitive,
        HeightReference,
        MaterialAppearance,
        PerInstanceColorAppearance,
        ColorMaterialProperty,
        DynamicGeometryUpdater,
        GeometryUpdater,
        GroundGeometryUpdater,
        Property) {
    'use strict';

    var scratchColor = new Color();
    var defaultOffset = Cartesian3.ZERO;
    var offsetScratch = new Cartesian3();
    var scratchRectangle = new Rectangle();

    function EllipseGeometryOptions(entity) {
        this.id = entity;
        this.vertexFormat = undefined;
        this.center = undefined;
        this.semiMajorAxis = undefined;
        this.semiMinorAxis = undefined;
        this.rotation = undefined;
        this.height = undefined;
        this.extrudedHeight = undefined;
        this.granularity = undefined;
        this.stRotation = undefined;
        this.numberOfVerticalLines = undefined;
        this.offsetAttribute = undefined;
    }

    /**
     * A {@link GeometryUpdater} for ellipses.
     * Clients do not normally create this class directly, but instead rely on {@link DataSourceDisplay}.
     * @alias EllipseGeometryUpdater
     * @constructor
     *
     * @param {Entity} entity The entity containing the geometry to be visualized.
     * @param {Scene} scene The scene where visualization is taking place.
     */
    function EllipseGeometryUpdater(entity, scene) {
        GroundGeometryUpdater.call(this, {
            entity : entity,
            scene : scene,
            geometryOptions : new EllipseGeometryOptions(entity),
            geometryPropertyName : 'ellipse',
            observedPropertyNames : ['availability', 'position', 'ellipse']
        });

        this._onEntityPropertyChanged(entity, 'ellipse', entity.ellipse, undefined);
    }

    if (defined(Object.create)) {
        EllipseGeometryUpdater.prototype = Object.create(GroundGeometryUpdater.prototype);
        EllipseGeometryUpdater.prototype.constructor = EllipseGeometryUpdater;
    }

    /**
     * Creates the geometry instance which represents the fill of the geometry.
     *
     * @param {JulianDate} time The time to use when retrieving initial attribute values.
     * @returns {GeometryInstance} The geometry instance representing the filled portion of the geometry.
     *
     * @exception {DeveloperError} This instance does not represent a filled geometry.
     */
    EllipseGeometryUpdater.prototype.createFillGeometryInstance = function(time) {
        //>>includeStart('debug', pragmas.debug);
        Check.defined('time', time);

        if (!this._fillEnabled) {
            throw new DeveloperError('This instance does not represent a filled geometry.');
        }
        //>>includeEnd('debug');

        var entity = this._entity;
        var isAvailable = entity.isAvailable(time);

        var attributes = {
            show : new ShowGeometryInstanceAttribute(isAvailable && entity.isShowing && this._showProperty.getValue(time) && this._fillProperty.getValue(time)),
            distanceDisplayCondition : DistanceDisplayConditionGeometryInstanceAttribute.fromDistanceDisplayCondition(this._distanceDisplayConditionProperty.getValue(time)),
            offset : undefined,
            color : undefined
        };

        if (this._materialProperty instanceof ColorMaterialProperty) {
            var currentColor;
            if (defined(this._materialProperty.color) && (this._materialProperty.color.isConstant || isAvailable)) {
                currentColor = this._materialProperty.color.getValue(time, scratchColor);
            }
            if (!defined(currentColor)) {
                currentColor = Color.WHITE;
            }
            attributes.color = ColorGeometryInstanceAttribute.fromColor(currentColor);
        }

        if (defined(this._options.offsetAttribute)) {
            attributes.offset = OffsetGeometryInstanceAttribute.fromCartesian3(Property.getValueOrDefault(this._terrainOffsetProperty, time, defaultOffset, offsetScratch));
        }

        return new GeometryInstance({
            id : entity,
            geometry : new EllipseGeometry(this._options),
            attributes : attributes
        });
    };

    /**
     * Creates the geometry instance which represents the outline of the geometry.
     *
     * @param {JulianDate} time The time to use when retrieving initial attribute values.
     * @returns {GeometryInstance} The geometry instance representing the outline portion of the geometry.
     *
     * @exception {DeveloperError} This instance does not represent an outlined geometry.
     */
    EllipseGeometryUpdater.prototype.createOutlineGeometryInstance = function(time) {
        //>>includeStart('debug', pragmas.debug);
        Check.defined('time', time);

        if (!this._outlineEnabled) {
            throw new DeveloperError('This instance does not represent an outlined geometry.');
        }
        //>>includeEnd('debug');

        var entity = this._entity;
        var isAvailable = entity.isAvailable(time);
        var outlineColor = Property.getValueOrDefault(this._outlineColorProperty, time, Color.BLACK, scratchColor);
        var distanceDisplayCondition = this._distanceDisplayConditionProperty.getValue(time);

        var attributes = {
            show : new ShowGeometryInstanceAttribute(isAvailable && entity.isShowing && this._showProperty.getValue(time) && this._showOutlineProperty.getValue(time)),
            color : ColorGeometryInstanceAttribute.fromColor(outlineColor),
            distanceDisplayCondition : DistanceDisplayConditionGeometryInstanceAttribute.fromDistanceDisplayCondition(distanceDisplayCondition),
            offset : undefined
        };

        if (defined(this._options.offsetAttribute)) {
            attributes.offset = OffsetGeometryInstanceAttribute.fromCartesian3(Property.getValueOrDefault(this._terrainOffsetProperty, time, defaultOffset, offsetScratch));
        }

        return new GeometryInstance({
            id : entity,
            geometry : new EllipseOutlineGeometry(this._options),
            attributes : attributes
        });
    };

    EllipseGeometryUpdater.prototype._computeCenter = function(time, result) {
        return Property.getValueOrUndefined(this._entity.position, time, result);
    };

    EllipseGeometryUpdater.prototype._isHidden = function(entity, ellipse) {
        var position = entity.position;

        return !defined(position) || !defined(ellipse.semiMajorAxis) || !defined(ellipse.semiMinorAxis) || GeometryUpdater.prototype._isHidden.call(this, entity, ellipse);
    };

    EllipseGeometryUpdater.prototype._isOnTerrain = function(entity, ellipse) {
        return this._fillEnabled && !defined(ellipse.height) && !defined(ellipse.extrudedHeight) && GroundPrimitive.isSupported(this._scene);
    };

    EllipseGeometryUpdater.prototype._isDynamic = function(entity, ellipse) {
        return !entity.position.isConstant || //
               !ellipse.semiMajorAxis.isConstant || //
               !ellipse.semiMinorAxis.isConstant || //
               !Property.isConstant(ellipse.rotation) || //
               !Property.isConstant(ellipse.height) || //
               !Property.isConstant(ellipse.extrudedHeight) || //
               !Property.isConstant(ellipse.granularity) || //
               !Property.isConstant(ellipse.stRotation) || //
               !Property.isConstant(ellipse.outlineWidth) || //
               !Property.isConstant(ellipse.numberOfVerticalLines) || //
               !Property.isConstant(ellipse.zIndex) || //
               (this._onTerrain && !Property.isConstant(this._materialProperty));
    };

    EllipseGeometryUpdater.prototype._getIsClosed = function(options) {
        var height = options.height;
        var extrudedHeight = options.extrudedHeight;
        return height === 0 || (defined(extrudedHeight) && extrudedHeight !== height);
    };

    EllipseGeometryUpdater.prototype._setStaticOptions = function(entity, ellipse) {
        var height = ellipse.height;
        var heightReference = ellipse.heightReference;
        var extrudedHeight = ellipse.extrudedHeight;
        var extrudedHeightReference = ellipse.extrudedHeightReference;

        var options = this._options;
        options.vertexFormat = (this._materialProperty instanceof ColorMaterialProperty) ? PerInstanceColorAppearance.VERTEX_FORMAT : MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat;
        options.center = entity.position.getValue(Iso8601.MINIMUM_VALUE, options.center);
        options.semiMajorAxis = ellipse.semiMajorAxis.getValue(Iso8601.MINIMUM_VALUE, options.semiMajorAxis);
        options.semiMinorAxis = ellipse.semiMinorAxis.getValue(Iso8601.MINIMUM_VALUE, options.semiMinorAxis);
        options.rotation = Property.getValueOrUndefined(ellipse.rotation, Iso8601.MINIMUM_VALUE);
        options.granularity = Property.getValueOrUndefined(ellipse.granularity, Iso8601.MINIMUM_VALUE);
        options.stRotation = Property.getValueOrUndefined(ellipse.stRotation, Iso8601.MINIMUM_VALUE);
        options.numberOfVerticalLines = Property.getValueOrUndefined(ellipse.numberOfVerticalLines, Iso8601.MINIMUM_VALUE);
        options.offsetAttribute = GroundGeometryUpdater.computeGeometryOffsetAttribute(heightReference, extrudedHeightReference, Iso8601.MINIMUM_VALUE);
        options.height = GroundGeometryUpdater.getGeometryHeight(height, heightReference, Iso8601.MINIMUM_VALUE);

        var extrudedHeightValue = GroundGeometryUpdater.getGeometryExtrudedHeight(extrudedHeight, extrudedHeightReference, Iso8601.MINIMUM_VALUE);
        if (extrudedHeightValue === GroundGeometryUpdater.CLAMP_TO_GROUND) {
            extrudedHeightValue = ApproximateTerrainHeights.getApproximateTerrainHeights(EllipseGeometry.computeRectangle(options, scratchRectangle)).minimumTerrainHeight;
        }

        options.extrudedHeight = extrudedHeightValue;
    };

    EllipseGeometryUpdater.DynamicGeometryUpdater = DynamicEllipseGeometryUpdater;

    /**
     * @private
     */
    function DynamicEllipseGeometryUpdater(geometryUpdater, primitives, groundPrimitives) {
        DynamicGeometryUpdater.call(this, geometryUpdater, primitives, groundPrimitives);
    }

    if (defined(Object.create)) {
        DynamicEllipseGeometryUpdater.prototype = Object.create(DynamicGeometryUpdater.prototype);
        DynamicEllipseGeometryUpdater.prototype.constructor = DynamicEllipseGeometryUpdater;
    }

    DynamicEllipseGeometryUpdater.prototype._isHidden = function(entity, ellipse, time) {
        var options = this._options;
        return !defined(options.center) || !defined(options.semiMajorAxis) || !defined(options.semiMinorAxis) || DynamicGeometryUpdater.prototype._isHidden.call(this, entity, ellipse, time);
    };

    DynamicEllipseGeometryUpdater.prototype._setOptions = function(entity, ellipse, time) {
        var options = this._options;
        var height = ellipse.height;
        var heightReference = ellipse.heightReference;
        var extrudedHeight = ellipse.extrudedHeight;
        var extrudedHeightReference = ellipse.extrudedHeightReference;

        options.center = Property.getValueOrUndefined(entity.position, time, options.center);
        options.semiMajorAxis = Property.getValueOrUndefined(ellipse.semiMajorAxis, time);
        options.semiMinorAxis = Property.getValueOrUndefined(ellipse.semiMinorAxis, time);
        options.rotation = Property.getValueOrUndefined(ellipse.rotation, time);
        options.granularity = Property.getValueOrUndefined(ellipse.granularity, time);
        options.stRotation = Property.getValueOrUndefined(ellipse.stRotation, time);
        options.numberOfVerticalLines = Property.getValueOrUndefined(ellipse.numberOfVerticalLines, time);
        options.offsetAttribute = GroundGeometryUpdater.computeGeometryOffsetAttribute(heightReference, extrudedHeightReference, time);
        options.height = GroundGeometryUpdater.getGeometryHeight(height, heightReference, time);

        var extrudedHeightValue = GroundGeometryUpdater.getGeometryExtrudedHeight(extrudedHeight, extrudedHeightReference, time);
        if (extrudedHeightValue === GroundGeometryUpdater.CLAMP_TO_GROUND) {
            extrudedHeightValue = ApproximateTerrainHeights.getApproximateTerrainHeights(EllipseGeometry.computeRectangle(options, scratchRectangle)).minimumTerrainHeight;
        }

        options.extrudedHeight = extrudedHeightValue;
    };

    return EllipseGeometryUpdater;
});
